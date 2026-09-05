/**
 * Return the exact HTTPS origin that must be verified through Digital Asset Links,
 * or null when the URL cannot back a verified Custom Tabs postMessage channel.
 */
export const getCompanionOrigin = (companionUrl) => {
  if (typeof companionUrl !== 'string') return null;
  try {
    const launchUrl = new URL(companionUrl);
    return launchUrl.protocol === 'https:' ? launchUrl.origin : null;
  } catch (error) {
    return null;
  }
};

/** Return whether a companion URL is worth trying to open through Custom Tabs. */
export const canAttemptCustomTab = (companionUrl) => getCompanionOrigin(companionUrl) !== null;