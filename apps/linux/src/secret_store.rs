use anyhow::{Result, anyhow};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    io::{Read, Write},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{Arc, Mutex, MutexGuard, mpsc},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

const ACCESS_KEY_PREFIX: &str = "zerochat-access:v1:";
const MAX_SECRET_BYTES: usize = 256 * 1024;
const MAX_SECRET_TOOL_STDOUT_BYTES: usize = MAX_SECRET_BYTES + 2;
const SECRET_APP: &str = "ZeroChat";
const SECRET_GITHUB_ID: &str = "default";
const SECRET_KIND_GITHUB: &str = "github-token";
const SECRET_KIND_PROVIDER: &str = "provider-key";
const SECRET_KIND_SYNC: &str = "sync-passphrase";
const SECRET_SYNC_ID: &str = "default";
const SECRET_TOOL_POLL_INTERVAL: Duration = Duration::from_millis(10);
const SECRET_TOOL_TIMEOUT: Duration = Duration::from_secs(5);

pub trait SyncSecretStore: Send + Sync {
    fn sync_passphrase(&self) -> Result<String>;

    fn set_sync_passphrase(&self, value: &str) -> Result<()>;

    fn compare_exchange_sync_passphrase(&self, expected: &str, value: &str) -> Result<bool> {
        if self.sync_passphrase()? != expected {
            return Ok(false);
        }
        self.set_sync_passphrase(value)?;
        Ok(true)
    }

    fn github_token(&self) -> Result<String>;

    fn set_github_token(&self, value: &str) -> Result<()>;

    fn compare_exchange_github_token(&self, expected: &str, value: &str) -> Result<bool> {
        if self.github_token()? != expected {
            return Ok(false);
        }
        self.set_github_token(value)?;
        Ok(true)
    }

    fn provider_key(&self, provider_id: &str) -> Result<String>;

    fn set_provider_key(&self, provider_id: &str, value: &str) -> Result<()>;

    fn compare_exchange_provider_key(
        &self,
        provider_id: &str,
        expected: &str,
        value: &str,
    ) -> Result<bool> {
        if self.provider_key(provider_id)? != expected {
            return Ok(false);
        }
        self.set_provider_key(provider_id, value)?;
        Ok(true)
    }

    fn flush(&self) -> Result<()> {
        Ok(())
    }

    fn ensure_readable(&self) -> Result<()> {
        Ok(())
    }

    fn cloudflare_access_key(&self) -> Result<String> {
        Ok(derive_cloudflare_access_key(&self.sync_passphrase()?))
    }
}

pub fn derive_cloudflare_access_key(passphrase: &str) -> String {
    if passphrase.is_empty() {
        return String::new();
    }

    let digest = Sha256::digest(format!("{ACCESS_KEY_PREFIX}{passphrase}").as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

pub struct LinuxSecretStore {
    github_token: Mutex<String>,
    sync_passphrase: Mutex<String>,
    provider_keys: Mutex<BTreeMap<String, String>>,
    commands: mpsc::Sender<SecretCommand>,
    worker: Mutex<Option<JoinHandle<()>>>,
    issue: Arc<Mutex<Option<String>>>,
    lookup_issue: Arc<Mutex<Option<SecretStoreIssue>>>,
}

impl LinuxSecretStore {
    pub fn load(provider_ids: Vec<String>) -> Self {
        let issue = Arc::new(Mutex::new(None));
        let lookup_issue = Arc::new(Mutex::new(None));
        let mut service_available = true;
        let sync_passphrase = load_secret_into_cache(
            &mut service_available,
            SECRET_KIND_SYNC,
            SECRET_SYNC_ID,
            &issue,
            &lookup_issue,
        );
        let github_token = load_secret_into_cache(
            &mut service_available,
            SECRET_KIND_GITHUB,
            SECRET_GITHUB_ID,
            &issue,
            &lookup_issue,
        );
        let mut provider_keys = BTreeMap::new();
        for provider_id in provider_ids {
            let value = load_secret_into_cache(
                &mut service_available,
                SECRET_KIND_PROVIDER,
                &provider_id,
                &issue,
                &lookup_issue,
            );
            if !value.is_empty() {
                provider_keys.insert(provider_id, value);
            }
        }

        let (commands, worker) = spawn_secret_worker(issue.clone());
        Self {
            github_token: Mutex::new(github_token),
            sync_passphrase: Mutex::new(sync_passphrase),
            provider_keys: Mutex::new(provider_keys),
            commands,
            worker: Mutex::new(worker),
            issue,
            lookup_issue,
        }
    }

    pub fn set_sync_passphrase(&self, value: &str) -> Result<()> {
        let value = value.trim();
        self.ensure_secret_size(value)?;
        let mut cached = lock_recover(&self.sync_passphrase);
        let previous = cached.clone();
        *cached = value.to_owned();
        let result = if value.is_empty() {
            self.enqueue(SecretCommand::Clear {
                kind: SECRET_KIND_SYNC,
                id: SECRET_SYNC_ID.to_owned(),
            })
        } else {
            self.enqueue_store(
                SECRET_KIND_SYNC,
                SECRET_SYNC_ID,
                "ZeroChat data encryption password",
                value,
            )
        };
        if result.is_err() {
            *cached = previous;
        }
        result
    }

    pub fn clear_sync_passphrase(&self) -> Result<()> {
        self.set_sync_passphrase("")
    }

    pub fn github_token(&self) -> Result<String> {
        Ok(lock_recover(&self.github_token).clone())
    }

    pub fn set_github_token(&self, value: &str) -> Result<()> {
        let value = value.trim();
        self.ensure_secret_size(value)?;
        let mut cached = lock_recover(&self.github_token);
        let previous = cached.clone();
        *cached = value.to_owned();

        let result = if value.is_empty() {
            self.enqueue(SecretCommand::Clear {
                kind: SECRET_KIND_GITHUB,
                id: SECRET_GITHUB_ID.to_owned(),
            })
        } else {
            self.enqueue_store(
                SECRET_KIND_GITHUB,
                SECRET_GITHUB_ID,
                "ZeroChat GitHub token",
                value,
            )
        };
        if result.is_err() {
            *cached = previous;
        }
        result
    }

    pub(crate) fn take_issue(&self) -> Option<String> {
        lock_recover(&self.issue).take()
    }

    pub(crate) fn ensure_readable(&self) -> Result<()> {
        if let Some(issue) = *lock_recover(&self.lookup_issue) {
            return Err(anyhow!(issue));
        }
        Ok(())
    }

    pub(crate) fn flush(&self) -> Result<()> {
        self.ensure_readable()?;
        let (completion, result) = mpsc::channel();
        self.enqueue(SecretCommand::Flush { completion })?;
        result
            .recv()
            .map_err(|_| worker_unavailable_error(&self.issue))?
            .map_err(|issue| anyhow!(issue))
    }

    fn enqueue_store(&self, kind: &'static str, id: &str, label: &str, value: &str) -> Result<()> {
        self.ensure_secret_size(value)?;
        self.enqueue(SecretCommand::Store {
            kind,
            id: id.to_owned(),
            label: label.to_owned(),
            value: value.to_owned(),
        })
    }

    fn ensure_secret_size(&self, value: &str) -> Result<()> {
        if value.len() > MAX_SECRET_BYTES {
            let issue = SecretStoreIssue::new(SecretOperation::Store, SecretFailure::TooLarge);
            record_issue(&self.issue, issue);
            return Err(anyhow!(issue));
        }
        Ok(())
    }

    fn enqueue(&self, command: SecretCommand) -> Result<()> {
        self.commands.send(command).map_err(|_| {
            let issue = SecretStoreIssue::new(SecretOperation::Worker, SecretFailure::Unavailable);
            record_issue(&self.issue, issue);
            anyhow!(issue)
        })
    }
}

impl Drop for LinuxSecretStore {
    fn drop(&mut self) {
        let Some(worker) = lock_recover(&self.worker).take() else {
            return;
        };
        let (completion, result) = mpsc::channel();
        if self
            .commands
            .send(SecretCommand::Shutdown { completion })
            .is_ok()
        {
            let _ = result.recv();
        }
        let _ = worker.join();
    }
}

impl SyncSecretStore for LinuxSecretStore {
    fn sync_passphrase(&self) -> Result<String> {
        Ok(lock_recover(&self.sync_passphrase).clone())
    }

    fn set_sync_passphrase(&self, value: &str) -> Result<()> {
        LinuxSecretStore::set_sync_passphrase(self, value)
    }

    fn compare_exchange_sync_passphrase(&self, expected: &str, value: &str) -> Result<bool> {
        let value = value.trim();
        self.ensure_secret_size(value)?;
        let mut cached = lock_recover(&self.sync_passphrase);
        if cached.as_str() != expected {
            return Ok(false);
        }
        let previous = cached.clone();
        *cached = value.to_owned();
        let result = if value.is_empty() {
            self.enqueue(SecretCommand::Clear {
                kind: SECRET_KIND_SYNC,
                id: SECRET_SYNC_ID.to_owned(),
            })
        } else {
            self.enqueue_store(
                SECRET_KIND_SYNC,
                SECRET_SYNC_ID,
                "ZeroChat data encryption password",
                value,
            )
        };
        if result.is_err() {
            *cached = previous;
        }
        result.map(|()| true)
    }

    fn github_token(&self) -> Result<String> {
        LinuxSecretStore::github_token(self)
    }

    fn set_github_token(&self, value: &str) -> Result<()> {
        LinuxSecretStore::set_github_token(self, value)
    }

    fn compare_exchange_github_token(&self, expected: &str, value: &str) -> Result<bool> {
        let value = value.trim();
        self.ensure_secret_size(value)?;
        let mut cached = lock_recover(&self.github_token);
        if cached.as_str() != expected {
            return Ok(false);
        }
        let previous = cached.clone();
        *cached = value.to_owned();
        let result = if value.is_empty() {
            self.enqueue(SecretCommand::Clear {
                kind: SECRET_KIND_GITHUB,
                id: SECRET_GITHUB_ID.to_owned(),
            })
        } else {
            self.enqueue_store(
                SECRET_KIND_GITHUB,
                SECRET_GITHUB_ID,
                "ZeroChat GitHub token",
                value,
            )
        };
        if result.is_err() {
            *cached = previous;
        }
        result.map(|()| true)
    }

    fn provider_key(&self, provider_id: &str) -> Result<String> {
        Ok(lock_recover(&self.provider_keys)
            .get(provider_id)
            .cloned()
            .unwrap_or_default())
    }

    fn set_provider_key(&self, provider_id: &str, value: &str) -> Result<()> {
        let value = value.trim();
        self.ensure_secret_size(value)?;
        let mut keys = lock_recover(&self.provider_keys);
        let previous = keys.get(provider_id).cloned();
        if value.is_empty() {
            keys.remove(provider_id);
        } else {
            keys.insert(provider_id.to_owned(), value.to_owned());
        }
        let result = if value.is_empty() {
            self.enqueue(SecretCommand::Clear {
                kind: SECRET_KIND_PROVIDER,
                id: provider_id.to_owned(),
            })
        } else {
            self.enqueue_store(
                SECRET_KIND_PROVIDER,
                provider_id,
                &format!("ZeroChat provider key: {provider_id}"),
                value,
            )
        };
        if result.is_err() {
            restore_cached_provider_key(&mut keys, provider_id, previous);
        }
        result
    }

    fn compare_exchange_provider_key(
        &self,
        provider_id: &str,
        expected: &str,
        value: &str,
    ) -> Result<bool> {
        let value = value.trim();
        self.ensure_secret_size(value)?;
        let mut keys = lock_recover(&self.provider_keys);
        let previous = keys.get(provider_id).cloned();
        if previous.as_deref().unwrap_or_default() != expected {
            return Ok(false);
        }
        if value.is_empty() {
            keys.remove(provider_id);
        } else {
            keys.insert(provider_id.to_owned(), value.to_owned());
        }
        let result = if value.is_empty() {
            self.enqueue(SecretCommand::Clear {
                kind: SECRET_KIND_PROVIDER,
                id: provider_id.to_owned(),
            })
        } else {
            self.enqueue_store(
                SECRET_KIND_PROVIDER,
                provider_id,
                &format!("ZeroChat provider key: {provider_id}"),
                value,
            )
        };
        if result.is_err() {
            restore_cached_provider_key(&mut keys, provider_id, previous);
        }
        result.map(|()| true)
    }

    fn flush(&self) -> Result<()> {
        LinuxSecretStore::flush(self)
    }

    fn ensure_readable(&self) -> Result<()> {
        LinuxSecretStore::ensure_readable(self)
    }
}

fn restore_cached_provider_key(
    keys: &mut BTreeMap<String, String>,
    provider_id: &str,
    previous: Option<String>,
) {
    if let Some(previous) = previous {
        keys.insert(provider_id.to_owned(), previous);
    } else {
        keys.remove(provider_id);
    }
}

#[derive(Clone, Debug)]
enum SecretSlot {
    SyncPassphrase,
    GithubToken,
    ProviderKey(String),
}

fn secret_value<S: SyncSecretStore + ?Sized>(secrets: &S, slot: &SecretSlot) -> Result<String> {
    match slot {
        SecretSlot::SyncPassphrase => secrets.sync_passphrase(),
        SecretSlot::GithubToken => secrets.github_token(),
        SecretSlot::ProviderKey(provider_id) => secrets.provider_key(provider_id),
    }
}

fn compare_exchange_secret<S: SyncSecretStore + ?Sized>(
    secrets: &S,
    slot: &SecretSlot,
    expected: &str,
    value: &str,
) -> Result<bool> {
    match slot {
        SecretSlot::SyncPassphrase => secrets.compare_exchange_sync_passphrase(expected, value),
        SecretSlot::GithubToken => secrets.compare_exchange_github_token(expected, value),
        SecretSlot::ProviderKey(provider_id) => {
            secrets.compare_exchange_provider_key(provider_id, expected, value)
        }
    }
}

pub(crate) struct SecretClearTransaction<'a, S: SyncSecretStore + ?Sized> {
    secrets: &'a S,
    cleared: Vec<(SecretSlot, String)>,
}

impl<S: SyncSecretStore + ?Sized> SecretClearTransaction<'_, S> {
    pub(crate) fn rollback(&self) -> Result<()> {
        let mut errors = Vec::new();
        for (slot, previous) in self.cleared.iter().rev() {
            match compare_exchange_secret(self.secrets, slot, "", previous) {
                Ok(true) | Ok(false) => {}
                Err(error) => errors.push(error),
            }
        }
        if let Err(error) = self.secrets.flush() {
            errors.push(error);
        }
        combine_secret_errors(errors)
    }
}

pub(crate) fn clear_secrets_transactionally<'a, S: SyncSecretStore + ?Sized>(
    secrets: &'a S,
    provider_ids: &BTreeSet<String>,
) -> Result<SecretClearTransaction<'a, S>> {
    let mut slots = vec![SecretSlot::SyncPassphrase, SecretSlot::GithubToken];
    slots.extend(provider_ids.iter().cloned().map(SecretSlot::ProviderKey));
    let mut transaction = SecretClearTransaction {
        secrets,
        cleared: Vec::new(),
    };

    for slot in slots {
        let previous = secret_value(secrets, &slot)?;
        if previous.is_empty() {
            continue;
        }
        match compare_exchange_secret(secrets, &slot, &previous, "") {
            Ok(true) => transaction.cleared.push((slot, previous)),
            Ok(false) => {
                return Err(rollback_secret_transaction_after_failure(
                    anyhow!("A saved secret changed while local data was being reset."),
                    &transaction,
                ));
            }
            Err(error) => {
                return Err(rollback_secret_transaction_after_failure(
                    error,
                    &transaction,
                ));
            }
        }
    }

    if let Err(error) = secrets.flush() {
        return Err(rollback_secret_transaction_after_failure(
            error,
            &transaction,
        ));
    }
    Ok(transaction)
}

fn rollback_secret_transaction_after_failure<S: SyncSecretStore + ?Sized>(
    operation_error: anyhow::Error,
    transaction: &SecretClearTransaction<'_, S>,
) -> anyhow::Error {
    match transaction.rollback() {
        Ok(()) => operation_error,
        Err(rollback_error) => {
            anyhow!("{operation_error:#}; secret rollback failed: {rollback_error:#}")
        }
    }
}

pub(crate) struct ProviderKeyTransaction<'a, S: SyncSecretStore + ?Sized> {
    secrets: &'a S,
    previous: BTreeMap<String, String>,
    applied: BTreeMap<String, String>,
}

pub(crate) struct SecretValueTransaction<'a, S: SyncSecretStore + ?Sized> {
    secrets: &'a S,
    slot: SecretSlot,
    previous: String,
    applied: Option<String>,
}

impl<S: SyncSecretStore + ?Sized> SecretValueTransaction<'_, S> {
    pub(crate) fn rollback(&self) -> Result<()> {
        let Some(applied) = self.applied.as_deref() else {
            return Ok(());
        };

        let mut errors = Vec::new();
        match compare_exchange_secret(self.secrets, &self.slot, applied, &self.previous) {
            Ok(true) | Ok(false) => {}
            Err(error) => errors.push(error),
        }
        if let Err(error) = self.secrets.flush() {
            errors.push(error);
        }
        combine_secret_errors(errors)
    }
}

fn stage_secret_value_transactionally<'a, S: SyncSecretStore + ?Sized>(
    secrets: &'a S,
    slot: SecretSlot,
    value: &str,
) -> Result<SecretValueTransaction<'a, S>> {
    let previous = secret_value(secrets, &slot)?;
    let value = value.trim().to_owned();
    if previous == value {
        return Ok(SecretValueTransaction {
            secrets,
            slot,
            previous,
            applied: None,
        });
    }

    match compare_exchange_secret(secrets, &slot, &previous, &value) {
        Ok(true) => Ok(SecretValueTransaction {
            secrets,
            slot,
            previous,
            applied: Some(value),
        }),
        Ok(false) => Err(anyhow!(
            "The saved secret changed while local data was being committed."
        )),
        Err(error) => Err(error),
    }
}

pub(crate) fn stage_sync_passphrase_transactionally<'a, S: SyncSecretStore + ?Sized>(
    secrets: &'a S,
    value: &str,
) -> Result<SecretValueTransaction<'a, S>> {
    stage_secret_value_transactionally(secrets, SecretSlot::SyncPassphrase, value)
}

pub(crate) fn stage_github_token_transactionally<'a, S: SyncSecretStore + ?Sized>(
    secrets: &'a S,
    value: &str,
) -> Result<SecretValueTransaction<'a, S>> {
    stage_secret_value_transactionally(secrets, SecretSlot::GithubToken, value)
}

fn secret_value_transaction_after_direct_set<'a, S: SyncSecretStore + ?Sized>(
    secrets: &'a S,
    slot: SecretSlot,
    previous: String,
    value: &str,
) -> Result<SecretValueTransaction<'a, S>> {
    let value = value.trim().to_owned();
    if secret_value(secrets, &slot)? != value {
        return Err(anyhow!(
            "The saved secret changed while local data was being committed."
        ));
    }

    Ok(SecretValueTransaction {
        secrets,
        slot,
        applied: (previous != value).then_some(value),
        previous,
    })
}

pub(crate) fn sync_passphrase_transaction_after_direct_set<'a, S: SyncSecretStore + ?Sized>(
    secrets: &'a S,
    previous: String,
    value: &str,
) -> Result<SecretValueTransaction<'a, S>> {
    secret_value_transaction_after_direct_set(secrets, SecretSlot::SyncPassphrase, previous, value)
}

pub(crate) fn github_token_transaction_after_direct_set<'a, S: SyncSecretStore + ?Sized>(
    secrets: &'a S,
    previous: String,
    value: &str,
) -> Result<SecretValueTransaction<'a, S>> {
    secret_value_transaction_after_direct_set(secrets, SecretSlot::GithubToken, previous, value)
}

pub(crate) fn rollback_secret_value_after_failure<S: SyncSecretStore + ?Sized>(
    operation_error: anyhow::Error,
    transaction: &SecretValueTransaction<'_, S>,
) -> anyhow::Error {
    match transaction.rollback() {
        Ok(()) => operation_error,
        Err(rollback_error) => {
            anyhow!("{operation_error:#}; secret rollback failed: {rollback_error:#}")
        }
    }
}

impl<S: SyncSecretStore + ?Sized> ProviderKeyTransaction<'_, S> {
    pub(crate) fn rollback(&self) -> Result<()> {
        let mut errors = Vec::new();
        for (provider_id, applied_value) in self.applied.iter().rev() {
            let previous_value = self
                .previous
                .get(provider_id)
                .map(String::as_str)
                .unwrap_or_default();
            match self.secrets.compare_exchange_provider_key(
                provider_id,
                applied_value,
                previous_value,
            ) {
                Ok(true) | Ok(false) => {}
                Err(error) => errors.push(error),
            }
        }
        if let Err(error) = self.secrets.flush() {
            errors.push(error);
        }
        combine_secret_errors(errors)
    }
}

pub(crate) fn replace_provider_keys_transactionally<'a, S: SyncSecretStore + ?Sized>(
    secrets: &'a S,
    replacements: &BTreeMap<String, String>,
) -> Result<ProviderKeyTransaction<'a, S>> {
    let transaction = stage_provider_keys_transactionally(secrets, replacements)?;
    if let Err(error) = secrets.flush() {
        return Err(rollback_provider_keys_after_failure(error, &transaction));
    }
    Ok(transaction)
}

pub(crate) fn stage_provider_keys_transactionally<'a, S: SyncSecretStore + ?Sized>(
    secrets: &'a S,
    replacements: &BTreeMap<String, String>,
) -> Result<ProviderKeyTransaction<'a, S>> {
    let mut previous = BTreeMap::new();
    for provider_id in replacements.keys() {
        previous.insert(provider_id.clone(), secrets.provider_key(provider_id)?);
    }

    let mut transaction = ProviderKeyTransaction {
        secrets,
        previous,
        applied: BTreeMap::new(),
    };
    for (provider_id, value) in replacements {
        let value = value.trim();
        let expected = transaction
            .previous
            .get(provider_id)
            .map(String::as_str)
            .unwrap_or_default();
        if expected == value {
            continue;
        }
        match secrets.compare_exchange_provider_key(provider_id, expected, value) {
            Ok(true) => {
                transaction
                    .applied
                    .insert(provider_id.clone(), value.to_owned());
            }
            Ok(false) => {
                return Err(rollback_provider_keys_after_failure(
                    anyhow!("Provider secret changed while data was being committed."),
                    &transaction,
                ));
            }
            Err(error) => {
                return Err(rollback_provider_keys_after_failure(error, &transaction));
            }
        }
    }

    Ok(transaction)
}

pub(crate) fn rollback_provider_keys_after_failure<S: SyncSecretStore + ?Sized>(
    operation_error: anyhow::Error,
    transaction: &ProviderKeyTransaction<'_, S>,
) -> anyhow::Error {
    match transaction.rollback() {
        Ok(()) => operation_error,
        Err(rollback_error) => {
            anyhow!("{operation_error:#}; provider secret rollback failed: {rollback_error:#}")
        }
    }
}

fn combine_secret_errors(mut errors: Vec<anyhow::Error>) -> Result<()> {
    if errors.is_empty() {
        return Ok(());
    }
    let first = errors.remove(0);
    if errors.is_empty() {
        return Err(first);
    }
    let details = errors
        .into_iter()
        .map(|error| format!("{error:#}"))
        .collect::<Vec<_>>()
        .join("; ");
    Err(anyhow!(
        "{first:#}; additional rollback failures: {details}"
    ))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SecretOperation {
    Lookup,
    Store,
    Clear,
    Worker,
}

impl fmt::Display for SecretOperation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Lookup => "lookup",
            Self::Store => "store",
            Self::Clear => "clear",
            Self::Worker => "worker",
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SecretFailure {
    InvalidOutput,
    Rejected,
    TimedOut,
    TooLarge,
    Unavailable,
}

impl fmt::Display for SecretFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidOutput => "returned invalid output",
            Self::Rejected => "was rejected",
            Self::TimedOut => "timed out",
            Self::TooLarge => "exceeded the size limit",
            Self::Unavailable => "is unavailable",
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SecretStoreIssue {
    operation: SecretOperation,
    failure: SecretFailure,
}

impl SecretStoreIssue {
    fn new(operation: SecretOperation, failure: SecretFailure) -> Self {
        Self { operation, failure }
    }

    fn user_message(self) -> &'static str {
        match self.operation {
            SecretOperation::Lookup => {
                "System keyring access failed; saved secrets are unavailable for this session."
            }
            SecretOperation::Store | SecretOperation::Worker => {
                "System keyring write failed; the secret remains in memory for this session."
            }
            SecretOperation::Clear => {
                "System keyring clear failed; the saved secret may still exist."
            }
        }
    }
}

impl fmt::Display for SecretStoreIssue {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "Secret Service {} {}",
            self.operation, self.failure
        )
    }
}

enum SecretCommand {
    Store {
        kind: &'static str,
        id: String,
        label: String,
        value: String,
    },
    Clear {
        kind: &'static str,
        id: String,
    },
    Flush {
        completion: mpsc::Sender<std::result::Result<(), SecretStoreIssue>>,
    },
    Shutdown {
        completion: mpsc::Sender<std::result::Result<(), SecretStoreIssue>>,
    },
}

#[derive(Debug)]
struct SecretToolOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr_present: bool,
}

fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn record_issue(slot: &Arc<Mutex<Option<String>>>, issue: SecretStoreIssue) {
    eprintln!("ZeroChat Secret Service: {issue}");
    *lock_recover(slot) = Some(issue.user_message().to_owned());
}

fn worker_unavailable_error(issue: &Arc<Mutex<Option<String>>>) -> anyhow::Error {
    let failure = SecretStoreIssue::new(SecretOperation::Worker, SecretFailure::Unavailable);
    record_issue(issue, failure);
    anyhow!(failure)
}

fn load_secret_into_cache(
    service_available: &mut bool,
    kind: &str,
    id: &str,
    issue: &Arc<Mutex<Option<String>>>,
    lookup_issue: &Arc<Mutex<Option<SecretStoreIssue>>>,
) -> String {
    if !*service_available {
        return String::new();
    }
    match lookup_secret(kind, id) {
        Ok(value) => value.unwrap_or_default(),
        Err(error) => {
            *service_available = false;
            *lock_recover(lookup_issue) = Some(error);
            record_issue(issue, error);
            String::new()
        }
    }
}

fn spawn_secret_worker(
    issue: Arc<Mutex<Option<String>>>,
) -> (mpsc::Sender<SecretCommand>, Option<JoinHandle<()>>) {
    let (sender, receiver) = mpsc::channel();
    let worker_issue = issue.clone();
    let spawned = thread::Builder::new()
        .name("zerochat-secret-service".to_owned())
        .spawn(move || run_secret_worker(receiver, worker_issue, execute_secret_command));
    if spawned.is_err() {
        record_issue(
            &issue,
            SecretStoreIssue::new(SecretOperation::Worker, SecretFailure::Unavailable),
        );
    }
    (sender, spawned.ok())
}

fn run_secret_worker(
    receiver: mpsc::Receiver<SecretCommand>,
    issue: Arc<Mutex<Option<String>>>,
    mut execute: impl FnMut(SecretCommand) -> std::result::Result<(), SecretStoreIssue>,
) {
    let mut pending_failure = None;
    while let Ok(command) = receiver.recv() {
        match command {
            SecretCommand::Flush { completion } => {
                let _ = completion.send(pending_failure.take().map_or(Ok(()), Err));
            }
            SecretCommand::Shutdown { completion } => {
                let _ = completion.send(pending_failure.take().map_or(Ok(()), Err));
                break;
            }
            mutation => {
                if let Err(error) = execute(mutation) {
                    record_issue(&issue, error);
                    pending_failure.get_or_insert(error);
                }
            }
        }
    }
}

fn execute_secret_command(command: SecretCommand) -> std::result::Result<(), SecretStoreIssue> {
    match command {
        SecretCommand::Store {
            kind,
            id,
            label,
            value,
        } => persist_secret(kind, &id, &label, &value),
        SecretCommand::Clear { kind, id } => clear_secret(kind, &id),
        SecretCommand::Flush { .. } | SecretCommand::Shutdown { .. } => unreachable!(),
    }
}

fn secret_tool_args<'a>(kind: &'a str, id: &'a str) -> [&'a str; 6] {
    ["application", SECRET_APP, "kind", kind, "id", id]
}

fn lookup_secret(kind: &str, id: &str) -> std::result::Result<Option<String>, SecretStoreIssue> {
    let mut command = Command::new("secret-tool");
    command.arg("lookup").args(secret_tool_args(kind, id));
    lookup_secret_with_command(command, SECRET_TOOL_TIMEOUT)
}

fn lookup_secret_with_command(
    command: Command,
    timeout: Duration,
) -> std::result::Result<Option<String>, SecretStoreIssue> {
    let output = run_command(command, SecretOperation::Lookup, None, true, timeout)?;
    if !output.status.success() {
        return if output.stderr_present {
            Err(SecretStoreIssue::new(
                SecretOperation::Lookup,
                SecretFailure::Rejected,
            ))
        } else {
            Ok(None)
        };
    }

    let mut stdout = output.stdout;
    while stdout
        .last()
        .is_some_and(|byte| matches!(byte, b'\r' | b'\n'))
    {
        stdout.pop();
    }
    if stdout.len() > MAX_SECRET_BYTES {
        return Err(SecretStoreIssue::new(
            SecretOperation::Lookup,
            SecretFailure::TooLarge,
        ));
    }
    let value = String::from_utf8(stdout).map_err(|_| {
        SecretStoreIssue::new(SecretOperation::Lookup, SecretFailure::InvalidOutput)
    })?;
    Ok((!value.trim().is_empty()).then_some(value))
}

fn persist_secret(
    kind: &str,
    id: &str,
    label: &str,
    value: &str,
) -> std::result::Result<(), SecretStoreIssue> {
    let mut command = Command::new("secret-tool");
    command
        .arg("store")
        .arg("--label")
        .arg(label)
        .args(secret_tool_args(kind, id));
    let output = run_command(
        command,
        SecretOperation::Store,
        Some(value.as_bytes()),
        false,
        SECRET_TOOL_TIMEOUT,
    )?;
    if output.status.success() {
        Ok(())
    } else {
        Err(SecretStoreIssue::new(
            SecretOperation::Store,
            SecretFailure::Rejected,
        ))
    }
}

fn clear_secret(kind: &str, id: &str) -> std::result::Result<(), SecretStoreIssue> {
    let mut command = Command::new("secret-tool");
    command.arg("clear").args(secret_tool_args(kind, id));
    let output = run_command(
        command,
        SecretOperation::Clear,
        None,
        false,
        SECRET_TOOL_TIMEOUT,
    )?;
    if output.status.success() || !output.stderr_present {
        Ok(())
    } else {
        Err(SecretStoreIssue::new(
            SecretOperation::Clear,
            SecretFailure::Rejected,
        ))
    }
}

fn run_command(
    mut command: Command,
    operation: SecretOperation,
    input: Option<&[u8]>,
    capture_stdout: bool,
    timeout: Duration,
) -> std::result::Result<SecretToolOutput, SecretStoreIssue> {
    if input.is_some_and(|input| input.len() > MAX_SECRET_BYTES) {
        return Err(SecretStoreIssue::new(operation, SecretFailure::TooLarge));
    }
    command
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(if capture_stdout {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|_| SecretStoreIssue::new(operation, SecretFailure::Unavailable))?;
    let deadline = Instant::now() + timeout;

    let stdin = if input.is_some() {
        match child.stdin.take() {
            Some(stdin) => Some(stdin),
            None => {
                terminate_child(&mut child);
                return Err(SecretStoreIssue::new(operation, SecretFailure::Unavailable));
            }
        }
    } else {
        None
    };
    let stdout = if capture_stdout {
        match child.stdout.take() {
            Some(stdout) => Some(stdout),
            None => {
                terminate_child(&mut child);
                return Err(SecretStoreIssue::new(
                    operation,
                    SecretFailure::InvalidOutput,
                ));
            }
        }
    } else {
        None
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            terminate_child(&mut child);
            return Err(SecretStoreIssue::new(
                operation,
                SecretFailure::InvalidOutput,
            ));
        }
    };

    let stdout_reader = if let Some(stdout) = stdout {
        match spawn_bounded_reader(
            "zerochat-secret-stdout",
            stdout,
            operation,
            MAX_SECRET_TOOL_STDOUT_BYTES,
        ) {
            Ok(reader) => Some(reader),
            Err(()) => {
                terminate_child(&mut child);
                return Err(SecretStoreIssue::new(operation, SecretFailure::Unavailable));
            }
        }
    } else {
        None
    };
    let stderr_reader = match spawn_bounded_reader(
        "zerochat-secret-stderr",
        stderr,
        operation,
        MAX_SECRET_BYTES,
    ) {
        Ok(reader) => reader,
        Err(()) => {
            terminate_child(&mut child);
            if let Some(reader) = stdout_reader {
                let _ = reader.join();
            }
            return Err(SecretStoreIssue::new(operation, SecretFailure::Unavailable));
        }
    };
    let stdin_writer = if let (Some(input), Some(mut stdin)) = (input, stdin) {
        let input = input.to_vec();
        match thread::Builder::new()
            .name("zerochat-secret-stdin".to_owned())
            .spawn(move || stdin.write_all(&input))
        {
            Ok(writer) => Some(writer),
            Err(_) => {
                terminate_child(&mut child);
                if let Some(reader) = stdout_reader {
                    let _ = reader.join();
                }
                let _ = stderr_reader.join();
                return Err(SecretStoreIssue::new(operation, SecretFailure::Unavailable));
            }
        }
    } else {
        None
    };

    let status_result = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(SECRET_TOOL_POLL_INTERVAL),
            Ok(None) => {
                terminate_child(&mut child);
                break Err(SecretStoreIssue::new(operation, SecretFailure::TimedOut));
            }
            Err(_) => {
                terminate_child(&mut child);
                break Err(SecretStoreIssue::new(operation, SecretFailure::Unavailable));
            }
        }
    };
    let status = status_result?;
    let stdin_result = if let Some(stdin_writer) = stdin_writer {
        match stdin_writer.join() {
            Ok(Ok(())) => Ok(()),
            Ok(Err(_)) | Err(_) => {
                Err(SecretStoreIssue::new(operation, SecretFailure::Unavailable))
            }
        }
    } else {
        Ok(())
    };
    let stdout_result = if let Some(stdout_reader) = stdout_reader {
        join_bounded_reader(stdout_reader, operation)
    } else {
        Ok(Vec::new())
    };
    let stderr_result = join_bounded_reader(stderr_reader, operation);

    stdin_result?;
    let stdout = stdout_result?;
    let stderr_present = !stderr_result?.is_empty();
    Ok(SecretToolOutput {
        status,
        stdout,
        stderr_present,
    })
}

fn terminate_child(child: &mut Child) {
    match child.try_wait() {
        Ok(Some(_)) | Err(_) => {}
        Ok(None) => {
            if child.kill().is_ok() {
                let _ = child.wait();
            }
        }
    }
}

fn spawn_bounded_reader(
    name: &str,
    reader: impl Read + Send + 'static,
    operation: SecretOperation,
    max_bytes: usize,
) -> std::result::Result<thread::JoinHandle<std::result::Result<Vec<u8>, SecretStoreIssue>>, ()> {
    thread::Builder::new()
        .name(name.to_owned())
        .spawn(move || read_bounded(reader, operation, max_bytes))
        .map_err(|_| ())
}

fn join_bounded_reader(
    reader: thread::JoinHandle<std::result::Result<Vec<u8>, SecretStoreIssue>>,
    operation: SecretOperation,
) -> std::result::Result<Vec<u8>, SecretStoreIssue> {
    reader
        .join()
        .map_err(|_| SecretStoreIssue::new(operation, SecretFailure::Unavailable))?
}

fn read_bounded(
    reader: impl Read,
    operation: SecretOperation,
    max_bytes: usize,
) -> std::result::Result<Vec<u8>, SecretStoreIssue> {
    let mut bytes = Vec::new();
    reader
        .take((max_bytes + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| SecretStoreIssue::new(operation, SecretFailure::InvalidOutput))?;
    if bytes.len() > max_bytes {
        return Err(SecretStoreIssue::new(operation, SecretFailure::TooLarge));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FAKE_SECRET_TOOL_TIMEOUT: Duration = Duration::from_secs(5);

    #[derive(Default)]
    struct TransactionSecretStore {
        sync_passphrase: Mutex<String>,
        github_token: Mutex<String>,
        provider_keys: Mutex<BTreeMap<String, String>>,
        fail_compare_for: Mutex<Option<String>>,
        flush_calls: Mutex<usize>,
        flush_failures_remaining: Mutex<usize>,
    }

    impl SyncSecretStore for TransactionSecretStore {
        fn sync_passphrase(&self) -> Result<String> {
            Ok(lock_recover(&self.sync_passphrase).clone())
        }

        fn set_sync_passphrase(&self, value: &str) -> Result<()> {
            let current = self.sync_passphrase()?;
            if !self.compare_exchange_sync_passphrase(&current, value)? {
                return Err(anyhow!("test sync passphrase changed"));
            }
            Ok(())
        }

        fn compare_exchange_sync_passphrase(&self, expected: &str, value: &str) -> Result<bool> {
            if lock_recover(&self.fail_compare_for).as_deref() == Some("$sync") {
                return Err(anyhow!("injected sync passphrase failure"));
            }
            let mut current = lock_recover(&self.sync_passphrase);
            if current.as_str() != expected {
                return Ok(false);
            }
            *current = value.to_owned();
            Ok(true)
        }

        fn github_token(&self) -> Result<String> {
            Ok(lock_recover(&self.github_token).clone())
        }

        fn set_github_token(&self, value: &str) -> Result<()> {
            let current = self.github_token()?;
            if !self.compare_exchange_github_token(&current, value)? {
                return Err(anyhow!("test GitHub token changed"));
            }
            Ok(())
        }

        fn compare_exchange_github_token(&self, expected: &str, value: &str) -> Result<bool> {
            if lock_recover(&self.fail_compare_for).as_deref() == Some("$github") {
                return Err(anyhow!("injected GitHub token failure"));
            }
            let mut current = lock_recover(&self.github_token);
            if current.as_str() != expected {
                return Ok(false);
            }
            *current = value.to_owned();
            Ok(true)
        }

        fn provider_key(&self, provider_id: &str) -> Result<String> {
            Ok(lock_recover(&self.provider_keys)
                .get(provider_id)
                .cloned()
                .unwrap_or_default())
        }

        fn set_provider_key(&self, provider_id: &str, value: &str) -> Result<()> {
            let current = self.provider_key(provider_id)?;
            if !self.compare_exchange_provider_key(provider_id, &current, value)? {
                return Err(anyhow!("test provider key changed"));
            }
            Ok(())
        }

        fn compare_exchange_provider_key(
            &self,
            provider_id: &str,
            expected: &str,
            value: &str,
        ) -> Result<bool> {
            if lock_recover(&self.fail_compare_for).as_deref() == Some(provider_id) {
                return Err(anyhow!("injected provider key failure"));
            }
            let mut values = lock_recover(&self.provider_keys);
            if values
                .get(provider_id)
                .map(String::as_str)
                .unwrap_or_default()
                != expected
            {
                return Ok(false);
            }
            if value.is_empty() {
                values.remove(provider_id);
            } else {
                values.insert(provider_id.to_owned(), value.to_owned());
            }
            Ok(true)
        }

        fn flush(&self) -> Result<()> {
            *lock_recover(&self.flush_calls) += 1;
            let mut remaining = lock_recover(&self.flush_failures_remaining);
            if *remaining > 0 {
                *remaining -= 1;
                return Err(anyhow!("injected flush failure"));
            }
            Ok(())
        }
    }

    fn github_token_through_sync_store(store: &impl SyncSecretStore) -> Result<String> {
        store.github_token()
    }

    fn memory_only_store() -> (LinuxSecretStore, mpsc::Receiver<SecretCommand>) {
        let (commands, receiver) = mpsc::channel();
        (
            LinuxSecretStore {
                github_token: Mutex::new(String::new()),
                sync_passphrase: Mutex::new(String::new()),
                provider_keys: Mutex::new(BTreeMap::new()),
                commands,
                worker: Mutex::new(None),
                issue: Arc::new(Mutex::new(None)),
                lookup_issue: Arc::new(Mutex::new(None)),
            },
            receiver,
        )
    }

    #[test]
    fn initial_lookup_failure_remains_a_sync_blocker_after_notice_consumption() {
        let (store, _receiver) = memory_only_store();
        *lock_recover(&store.lookup_issue) = Some(SecretStoreIssue::new(
            SecretOperation::Lookup,
            SecretFailure::Unavailable,
        ));

        let error = store
            .flush()
            .expect_err("a failed initial keyring lookup must block flush");
        assert!(error.to_string().contains("Secret Service lookup"));
    }

    fn fake_secret_tool_lookup(secret_bytes: usize, stderr_bytes: usize) -> Command {
        let mut command = Command::new("sh");
        command.args([
            "-c",
            "head -c \"$1\" /dev/zero | tr '\\0' x; \
             head -c \"$2\" /dev/zero | tr '\\0' e >&2; \
             printf '\\n'",
            "secret-tool",
            &secret_bytes.to_string(),
            &stderr_bytes.to_string(),
        ]);
        command
    }

    #[test]
    fn fake_secret_tool_output_larger_than_pipe_capacity_is_drained() {
        let secret_bytes = 128 * 1024;
        let command = fake_secret_tool_lookup(secret_bytes, 128 * 1024);

        let value = lookup_secret_with_command(command, FAKE_SECRET_TOOL_TIMEOUT)
            .unwrap()
            .unwrap();

        assert_eq!(value.len(), secret_bytes);
        assert!(value.bytes().all(|byte| byte == b'x'));
    }

    #[test]
    fn fake_secret_tool_round_trips_maximum_length_secret() {
        let file_name = format!("zerochat-secret-tool-{}.test", std::process::id());
        let directory = std::env::temp_dir();
        let path = directory.join(&file_name);
        let secret = "x".repeat(MAX_SECRET_BYTES);

        let mut store = Command::new("sh");
        store
            .current_dir(&directory)
            .args(["-c", "cat > \"$1\"", "secret-tool", &file_name]);
        let stored = run_command(
            store,
            SecretOperation::Store,
            Some(secret.as_bytes()),
            false,
            FAKE_SECRET_TOOL_TIMEOUT,
        )
        .unwrap();

        let mut lookup = Command::new("sh");
        lookup.current_dir(&directory).args([
            "-c",
            "cat \"$1\"; printf '\\n'",
            "secret-tool",
            &file_name,
        ]);
        let loaded = lookup_secret_with_command(lookup, FAKE_SECRET_TOOL_TIMEOUT).unwrap();
        let _ = std::fs::remove_file(path);

        assert!(stored.status.success());
        assert_eq!(loaded.as_deref(), Some(secret.as_str()));
    }

    #[test]
    fn fake_secret_tool_rejects_secret_one_byte_over_limit_after_line_ending() {
        let command = fake_secret_tool_lookup(MAX_SECRET_BYTES + 1, 0);

        let error = lookup_secret_with_command(command, FAKE_SECRET_TOOL_TIMEOUT).unwrap_err();

        assert_eq!(error.operation, SecretOperation::Lookup);
        assert_eq!(error.failure, SecretFailure::TooLarge);
    }

    #[test]
    fn provider_key_updates_are_immediately_available_from_memory() {
        let (store, _receiver) = memory_only_store();

        store.set_provider_key("provider", "secret-value").unwrap();

        assert_eq!(store.provider_key("provider").unwrap(), "secret-value");
    }

    #[test]
    fn sync_secret_store_contract_exposes_github_token() {
        let (store, _receiver) = memory_only_store();

        store.set_github_token("github-secret").unwrap();

        assert_eq!(
            github_token_through_sync_store(&store).unwrap(),
            "github-secret"
        );
    }

    #[test]
    fn oversized_provider_key_does_not_replace_the_last_accepted_memory_value() {
        let (store, receiver) = memory_only_store();
        store.set_provider_key("provider", "accepted").unwrap();
        receiver.recv().unwrap();

        let error = store
            .set_provider_key("provider", &"x".repeat(MAX_SECRET_BYTES + 1))
            .unwrap_err();

        assert!(error.to_string().contains("exceeded the size limit"));
        assert_eq!(store.provider_key("provider").unwrap(), "accepted");
        assert!(matches!(
            receiver.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));
    }

    #[test]
    fn oversized_sync_passphrase_does_not_replace_the_last_accepted_memory_value() {
        let (store, receiver) = memory_only_store();
        store.set_sync_passphrase("accepted").unwrap();
        receiver.recv().unwrap();

        let error = store
            .set_sync_passphrase(&"x".repeat(MAX_SECRET_BYTES + 1))
            .unwrap_err();

        assert!(error.to_string().contains("exceeded the size limit"));
        assert_eq!(store.sync_passphrase().unwrap(), "accepted");
        assert!(matches!(
            receiver.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));
    }

    #[test]
    fn staged_sync_passphrase_rolls_back_after_snapshot_commit_failure() {
        let store = TransactionSecretStore::default();
        store.set_sync_passphrase("old").unwrap();

        let transaction = stage_sync_passphrase_transactionally(&store, "new").unwrap();
        assert_eq!(store.sync_passphrase().unwrap(), "new");

        let error =
            rollback_secret_value_after_failure(anyhow!("snapshot commit failed"), &transaction);

        assert!(error.to_string().contains("snapshot commit failed"));
        assert_eq!(store.sync_passphrase().unwrap(), "old");
    }

    #[test]
    fn direct_sync_passphrase_transaction_rolls_back_after_snapshot_commit_failure() {
        let store = TransactionSecretStore::default();
        store.set_sync_passphrase("old").unwrap();
        let previous = store.sync_passphrase().unwrap();
        store.set_sync_passphrase("new").unwrap();

        let transaction =
            sync_passphrase_transaction_after_direct_set(&store, previous, "new").unwrap();
        let error =
            rollback_secret_value_after_failure(anyhow!("snapshot commit failed"), &transaction);

        assert!(error.to_string().contains("snapshot commit failed"));
        assert_eq!(store.sync_passphrase().unwrap(), "old");
    }

    #[test]
    fn direct_github_token_transaction_rolls_back_after_snapshot_commit_failure() {
        let store = TransactionSecretStore::default();
        store.set_github_token("old").unwrap();
        let previous = store.github_token().unwrap();
        store.set_github_token("new").unwrap();

        let transaction =
            github_token_transaction_after_direct_set(&store, previous, "new").unwrap();
        let error =
            rollback_secret_value_after_failure(anyhow!("snapshot commit failed"), &transaction);

        assert!(error.to_string().contains("snapshot commit failed"));
        assert_eq!(store.github_token().unwrap(), "old");
    }

    #[test]
    fn staged_github_token_keeps_an_unchanged_value_without_a_rollback_write() {
        let store = TransactionSecretStore::default();
        store.set_github_token("same").unwrap();
        let flush_calls_before = *lock_recover(&store.flush_calls);

        let transaction = stage_github_token_transactionally(&store, "same").unwrap();
        transaction.rollback().unwrap();

        assert_eq!(store.github_token().unwrap(), "same");
        assert_eq!(*lock_recover(&store.flush_calls), flush_calls_before);
    }

    #[test]
    fn provider_key_transaction_rolls_back_every_applied_value_after_failure() {
        let store = TransactionSecretStore::default();
        *lock_recover(&store.provider_keys) = BTreeMap::from([
            ("a".to_owned(), "old-a".to_owned()),
            ("b".to_owned(), "old-b".to_owned()),
        ]);
        *lock_recover(&store.fail_compare_for) = Some("b".to_owned());

        let error = replace_provider_keys_transactionally(
            &store,
            &BTreeMap::from([
                ("a".to_owned(), "remote-a".to_owned()),
                ("b".to_owned(), "remote-b".to_owned()),
            ]),
        )
        .err()
        .expect("the injected second write must fail");

        assert!(error.to_string().contains("injected provider key failure"));
        assert_eq!(store.provider_key("a").unwrap(), "old-a");
        assert_eq!(store.provider_key("b").unwrap(), "old-b");
    }

    #[test]
    fn provider_key_rollback_preserves_a_newer_concurrent_secret() {
        let store = TransactionSecretStore::default();
        lock_recover(&store.provider_keys).insert("a".to_owned(), "old-a".to_owned());
        let transaction = replace_provider_keys_transactionally(
            &store,
            &BTreeMap::from([("a".to_owned(), "remote-a".to_owned())]),
        )
        .unwrap();
        lock_recover(&store.provider_keys).insert("a".to_owned(), "user-a".to_owned());

        transaction.rollback().unwrap();

        assert_eq!(store.provider_key("a").unwrap(), "user-a");
    }

    #[test]
    fn provider_key_flush_failure_restores_the_previous_values() {
        let store = TransactionSecretStore::default();
        lock_recover(&store.provider_keys).insert("a".to_owned(), "old-a".to_owned());
        *lock_recover(&store.flush_failures_remaining) = 1;

        let error = replace_provider_keys_transactionally(
            &store,
            &BTreeMap::from([("a".to_owned(), "remote-a".to_owned())]),
        )
        .err()
        .expect("the injected flush must fail");

        assert!(error.to_string().contains("injected flush failure"));
        assert_eq!(store.provider_key("a").unwrap(), "old-a");
    }

    #[test]
    fn staged_provider_key_commit_preserves_session_fallback_without_flushing() {
        let store = TransactionSecretStore::default();
        lock_recover(&store.provider_keys).insert("a".to_owned(), "old-a".to_owned());

        let transaction = stage_provider_keys_transactionally(
            &store,
            &BTreeMap::from([("a".to_owned(), "new-a".to_owned())]),
        )
        .unwrap();

        assert_eq!(store.provider_key("a").unwrap(), "new-a");
        assert_eq!(*lock_recover(&store.flush_calls), 0);

        transaction.rollback().unwrap();
        assert_eq!(store.provider_key("a").unwrap(), "old-a");
        assert_eq!(*lock_recover(&store.flush_calls), 1);
    }

    #[test]
    fn clear_transaction_rolls_back_every_secret_kind() {
        let store = TransactionSecretStore::default();
        *lock_recover(&store.sync_passphrase) = "old-passphrase".to_owned();
        *lock_recover(&store.github_token) = "old-token".to_owned();
        lock_recover(&store.provider_keys).insert("provider".to_owned(), "old-key".to_owned());
        let provider_ids = BTreeSet::from(["provider".to_owned()]);

        let transaction = clear_secrets_transactionally(&store, &provider_ids).unwrap();
        assert_eq!(store.sync_passphrase().unwrap(), "");
        assert_eq!(store.github_token().unwrap(), "");
        assert_eq!(store.provider_key("provider").unwrap(), "");

        transaction.rollback().unwrap();

        assert_eq!(store.sync_passphrase().unwrap(), "old-passphrase");
        assert_eq!(store.github_token().unwrap(), "old-token");
        assert_eq!(store.provider_key("provider").unwrap(), "old-key");
    }

    #[test]
    fn clear_transaction_restores_prior_secrets_after_partial_failure() {
        let store = TransactionSecretStore::default();
        *lock_recover(&store.sync_passphrase) = "old-passphrase".to_owned();
        *lock_recover(&store.github_token) = "old-token".to_owned();
        lock_recover(&store.provider_keys).insert("provider".to_owned(), "old-key".to_owned());
        *lock_recover(&store.fail_compare_for) = Some("provider".to_owned());

        let error = clear_secrets_transactionally(&store, &BTreeSet::from(["provider".to_owned()]))
            .err()
            .expect("the injected provider clear must fail");

        assert!(error.to_string().contains("injected provider key failure"));
        assert_eq!(store.sync_passphrase().unwrap(), "old-passphrase");
        assert_eq!(store.github_token().unwrap(), "old-token");
        assert_eq!(store.provider_key("provider").unwrap(), "old-key");
    }

    #[test]
    fn clear_transaction_flush_failure_restores_prior_secrets() {
        let store = TransactionSecretStore::default();
        *lock_recover(&store.sync_passphrase) = "old-passphrase".to_owned();
        *lock_recover(&store.flush_failures_remaining) = 1;

        let error = clear_secrets_transactionally(&store, &BTreeSet::new())
            .err()
            .expect("the injected flush must fail");

        assert!(error.to_string().contains("injected flush failure"));
        assert_eq!(store.sync_passphrase().unwrap(), "old-passphrase");
    }

    #[test]
    fn clear_rollback_preserves_a_newer_concurrent_secret() {
        let store = TransactionSecretStore::default();
        *lock_recover(&store.sync_passphrase) = "old-passphrase".to_owned();
        let transaction = clear_secrets_transactionally(&store, &BTreeSet::new()).unwrap();
        *lock_recover(&store.sync_passphrase) = "new-passphrase".to_owned();

        transaction.rollback().unwrap();

        assert_eq!(store.sync_passphrase().unwrap(), "new-passphrase");
    }

    #[test]
    fn flush_waits_for_preceding_secret_mutations() {
        let (commands, receiver) = mpsc::channel();
        let issue = Arc::new(Mutex::new(None));
        let executed = Arc::new(Mutex::new(Vec::new()));
        let worker_executed = executed.clone();
        let worker = thread::spawn(move || {
            run_secret_worker(receiver, issue, move |command| {
                if let SecretCommand::Clear { kind, id } = command {
                    lock_recover(&worker_executed).push((kind, id));
                }
                Ok(())
            });
        });

        commands
            .send(SecretCommand::Clear {
                kind: SECRET_KIND_PROVIDER,
                id: "provider".to_owned(),
            })
            .unwrap();
        let (completion, result) = mpsc::channel();
        commands.send(SecretCommand::Flush { completion }).unwrap();

        assert_eq!(result.recv().unwrap(), Ok(()));
        assert_eq!(
            *lock_recover(&executed),
            vec![(SECRET_KIND_PROVIDER, "provider".to_owned())]
        );

        let (completion, result) = mpsc::channel();
        commands
            .send(SecretCommand::Shutdown { completion })
            .unwrap();
        assert_eq!(result.recv().unwrap(), Ok(()));
        worker.join().unwrap();
    }

    #[test]
    fn flush_returns_the_first_preceding_worker_failure() {
        let (commands, receiver) = mpsc::channel();
        let issue = Arc::new(Mutex::new(None));
        let worker_issue = issue.clone();
        let worker = thread::spawn(move || {
            run_secret_worker(receiver, worker_issue, |_| {
                Err(SecretStoreIssue::new(
                    SecretOperation::Store,
                    SecretFailure::Rejected,
                ))
            });
        });

        commands
            .send(SecretCommand::Clear {
                kind: SECRET_KIND_PROVIDER,
                id: "provider".to_owned(),
            })
            .unwrap();
        let (completion, result) = mpsc::channel();
        commands.send(SecretCommand::Flush { completion }).unwrap();

        let failure = result.recv().unwrap().unwrap_err();
        assert_eq!(failure.operation, SecretOperation::Store);
        assert_eq!(failure.failure, SecretFailure::Rejected);
        assert!(lock_recover(&issue).is_some());

        let (completion, result) = mpsc::channel();
        commands
            .send(SecretCommand::Shutdown { completion })
            .unwrap();
        assert_eq!(result.recv().unwrap(), Ok(()));
        worker.join().unwrap();
    }

    #[test]
    fn command_failure_never_includes_child_output() {
        let secret = "must-not-appear";
        let mut command = Command::new("sh");
        command.args(["-c", &format!("printf '{secret}' >&2; exit 9")]);

        let output = run_command(
            command,
            SecretOperation::Store,
            None,
            false,
            Duration::from_secs(1),
        )
        .unwrap();
        let issue = if output.status.success() {
            panic!("test command unexpectedly succeeded");
        } else {
            SecretStoreIssue::new(SecretOperation::Store, SecretFailure::Rejected)
        };

        assert!(!issue.to_string().contains(secret));
        assert!(!issue.user_message().contains(secret));
    }

    #[test]
    fn command_timeout_kills_a_stuck_secret_tool_process() {
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 5"]);

        let error = run_command(
            command,
            SecretOperation::Lookup,
            None,
            false,
            Duration::from_millis(30),
        )
        .unwrap_err();

        assert_eq!(error.failure, SecretFailure::TimedOut);
        assert_eq!(error.operation, SecretOperation::Lookup);
    }

    #[test]
    fn timeout_also_bounds_a_child_that_never_reads_stdin() {
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 5"]);
        let input = vec![b'x'; MAX_SECRET_BYTES];
        let started = Instant::now();

        let error = run_command(
            command,
            SecretOperation::Store,
            Some(&input),
            false,
            Duration::from_millis(30),
        )
        .unwrap_err();

        assert_eq!(error.failure, SecretFailure::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
