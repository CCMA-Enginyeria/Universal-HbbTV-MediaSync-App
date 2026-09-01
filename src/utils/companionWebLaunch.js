/** Return whether a companion content ID targets the external TV-sync entry point. */
export const isExternalSyncWebContent = (url) =>
  typeof url === 'string' && /\/synctv\.html(?:[?#]|$)/i.test(url);

/** Build the Android Custom Tabs URL for the synchronized companion page. */
export const buildCustomTabsSyncUrl = (companionUrl) => {
  if (!isExternalSyncWebContent(companionUrl)) {
    throw new Error('The companion URL is not a synchronized external page.');
  }

  const launchUrl = new URL(companionUrl);
  if (launchUrl.protocol !== 'https:') {
    throw new Error('Custom Tabs messaging requires an HTTPS companion URL.');
  }
  return launchUrl.toString();
};

/** Return the exact HTTPS origin that must be verified through Digital Asset Links. */
export const getCompanionOrigin = (companionUrl) => {
  const launchUrl = new URL(companionUrl);
  if (launchUrl.protocol !== 'https:') {
    throw new Error('Custom Tabs messaging requires an HTTPS companion URL.');
  }
  return launchUrl.origin;
};