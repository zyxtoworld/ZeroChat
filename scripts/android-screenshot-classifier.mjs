export function looksLikeAndroidLaunchSplashStats(stats) {
  return (
    Number.isFinite(stats?.nearWhiteRatio) &&
    Number.isFinite(stats?.darkRatio) &&
    Number.isFinite(stats?.coloredRatio) &&
    Number.isFinite(stats?.nonBackgroundRatio) &&
    stats.nearWhiteRatio > 0.96 &&
    stats.darkRatio < 0.01 &&
    stats.coloredRatio > 0.01 &&
    stats.nonBackgroundRatio < 0.04
  )
}
