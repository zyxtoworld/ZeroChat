package app.zerochat.security

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ProviderDeletionRecoveryPlanTest {
    @Test
    fun keepsCredentialWhenCrashHappenedBeforeSnapshotDeletion() {
        val plan = providerDeletionRecoveryPlan(
            pendingProviderIds = setOf("provider-a"),
            activeProviderIds = setOf("provider-a", "provider-b"),
        )

        assertEquals(emptySet<String>(), plan.credentialIdsToRemove)
    }

    @Test
    fun removesCredentialWhenCrashHappenedAfterSnapshotDeletion() {
        val plan = providerDeletionRecoveryPlan(
            pendingProviderIds = setOf("deleted", "still-active"),
            activeProviderIds = setOf("still-active"),
        )

        assertEquals(setOf("deleted"), plan.credentialIdsToRemove)
    }
}
