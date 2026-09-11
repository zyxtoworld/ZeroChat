package app.zerochat

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class QuickAskIntentsTest {
    @Test
    fun savedStateWithoutAConsumedMarkerStillAcceptsAQuickAskLaunch() {
        assertTrue(
            shouldConsumeQuickAskOnCreate(
                savedQuickAskConsumed = false,
                isQuickAskIntent = true,
            ),
        )
    }

    @Test
    fun savedStateWithAConsumedMarkerDoesNotReplayTheSameQuickAskLaunch() {
        assertFalse(
            shouldConsumeQuickAskOnCreate(
                savedQuickAskConsumed = true,
                isQuickAskIntent = true,
            ),
        )
    }

    @Test
    fun aNormalLaunchDoesNotCreateAQuickAskEvent() {
        assertFalse(
            shouldConsumeQuickAskOnCreate(
                savedQuickAskConsumed = false,
                isQuickAskIntent = false,
            ),
        )
    }

    @Test
    // This JVM test covers repeated Quick Ask deliveries after the Activity owner receives them.
    // It does not verify repeated clicks of one Widget PendingIntent or task/process restore order.
    fun repeatedQuickAskDeliveriesIncrementTheActivityOwnerCount() {
        val owner = QuickAskActivityOwner()

        owner.onCreate(savedQuickAskConsumed = false, isQuickAskIntent = true)
        owner.onNewIntent(isQuickAskIntent = true)
        owner.onNewIntent(isQuickAskIntent = true)

        assertEquals(3L, owner.deliveryCount)
        assertTrue(owner.consumedForInstance)
    }

    @Test
    fun aFreshActivityOwnerSkipsTheSavedLaunchButAcceptsTheNextDelivery() {
        val firstOwner = QuickAskActivityOwner()
        firstOwner.onCreate(savedQuickAskConsumed = false, isQuickAskIntent = true)

        val recreatedOwner = QuickAskActivityOwner()
        recreatedOwner.onCreate(
            savedQuickAskConsumed = firstOwner.consumedForInstance,
            isQuickAskIntent = true,
        )
        assertEquals(0L, recreatedOwner.deliveryCount)

        recreatedOwner.onNewIntent(isQuickAskIntent = true)

        assertEquals(1L, recreatedOwner.deliveryCount)
        assertTrue(recreatedOwner.consumedForInstance)
    }
}
