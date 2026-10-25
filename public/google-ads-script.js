/** Read-only Google Ads Script. Configure URL + secret inside your private Ads script, never in a public repository. */
const SHEDKO_ENDPOINT = 'https://shedko-marketing-automation.vercel.app/api/ads/ingest';
const SHEDKO_SECRET = 'SET_A_PRIVATE_RANDOM_SECRET_24_OR_MORE_CHARACTERS';
function main() {
  if (SHEDKO_SECRET === 'SET_A_PRIVATE_RANDOM_SECRET_24_OR_MORE_CHARACTERS') {
    throw new Error('Set the private Shedko secret before running this script');
  }
  const account = AdsApp.currentAccount();
  const rows = AdsApp.search('SELECT campaign.id, campaign.name, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING LAST_7_DAYS');
  const batch = [];
  let imported = 0;
  while (rows.hasNext()) {
    const r = rows.next();
    batch.push({account_id:account.getCustomerId(),campaign_id:String(r.campaign.id),campaign:r.campaign.name,date:r.segments.date,currency:account.getCurrencyCode(),impressions:Number(r.metrics.impressions),clicks:Number(r.metrics.clicks),cost:Number(r.metrics.costMicros)/1e6,conversions:Number(r.metrics.conversions)});
    if (batch.length === 500) { imported += sendBatch(batch); batch.length = 0; }
  }
  if (batch.length || imported === 0) imported += sendBatch(batch);
  Logger.log('Соединение с Shedko подтверждено. Получено строк за 7 завершённых дней: ' + imported + '. Текущий день не включён.');
}
function sendBatch(rows) {
  const response = UrlFetchApp.fetch(SHEDKO_ENDPOINT, {method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+SHEDKO_SECRET},payload:JSON.stringify(rows),muteHttpExceptions:true});
  if (response.getResponseCode() !== 200) throw new Error('Shedko import failed with HTTP ' + response.getResponseCode());
  let result;
  try { result = JSON.parse(response.getContentText()); }
  catch (_) { throw new Error('Shedko returned an invalid import response'); }
  if (!result || result.imported !== rows.length) throw new Error('Shedko did not confirm the expected number of imported rows');
  return result.imported;
}
