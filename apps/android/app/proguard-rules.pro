# Keep Kotlinx Serialization metadata for the shared snapshot/sync DTOs.
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault
-keepclassmembers class app.zerochat.** {
    @kotlinx.serialization.Serializable *;
}

# AndroidX Security pulls Tink annotations that are compile-time only.
-dontwarn com.google.errorprone.annotations.CanIgnoreReturnValue
-dontwarn com.google.errorprone.annotations.CheckReturnValue
-dontwarn com.google.errorprone.annotations.Immutable
-dontwarn com.google.errorprone.annotations.RestrictedApi
-dontwarn javax.annotation.Nullable
-dontwarn javax.annotation.concurrent.GuardedBy
