use super::{LinuxAppState, now_millis};
use crate::models::{SkillSettings, UserSkill};

impl LinuxAppState {
    pub(crate) fn skill_settings(&self) -> SkillSettings {
        self.snapshot.borrow().skill_settings.clone()
    }

    pub(crate) fn skills(&self) -> Vec<UserSkill> {
        self.snapshot.borrow().skills.clone()
    }

    pub(crate) fn update_skill_settings(&self, mutate: impl FnOnce(&mut SkillSettings)) {
        {
            let mut snapshot = self.snapshot.borrow_mut();
            mutate(&mut snapshot.skill_settings);
            snapshot.updated_at = now_millis();
        }
        self.save();
    }

    pub(crate) fn add_skill(&self, mut skill: UserSkill) {
        {
            let mut snapshot = self.snapshot.borrow_mut();
            let now = now_millis();
            if skill.created_at == 0 {
                skill.created_at = now;
            }
            skill.updated_at = now;
            snapshot.skills.insert(0, skill);
            snapshot.updated_at = now;
        }
        self.save();
    }

    pub(crate) fn update_skill(&self, skill_id: &str, mutate: impl FnOnce(&mut UserSkill)) -> bool {
        let updated = {
            let mut snapshot = self.snapshot.borrow_mut();
            let mut updated_at = None;
            if let Some(skill) = snapshot
                .skills
                .iter_mut()
                .find(|skill| skill.id == skill_id)
            {
                mutate(skill);
                let now = now_millis();
                skill.updated_at = now;
                updated_at = Some(now);
            }

            if let Some(updated_at) = updated_at {
                snapshot.updated_at = updated_at;
                true
            } else {
                false
            }
        };

        if updated {
            self.save();
        }

        updated
    }

    pub(crate) fn delete_skill(&self, skill_id: &str) -> bool {
        let deleted = {
            let mut snapshot = self.snapshot.borrow_mut();
            let previous_len = snapshot.skills.len();
            snapshot.skills.retain(|skill| skill.id != skill_id);
            if snapshot.skills.len() == previous_len {
                false
            } else {
                snapshot.updated_at = now_millis();
                true
            }
        };

        if deleted {
            self.save();
        }

        deleted
    }
}
