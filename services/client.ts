import 'dotenv/config';

// @signalwire/compatibility-api does not ship type declarations, so we load it
// via require (typed as `any`) rather than a typed import.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { RestClient } = require('@signalwire/compatibility-api');

const client = RestClient(
  process.env.SIGNALWIRE_PROJECT_ID,
  process.env.SIGNALWIRE_API_TOKEN,
  { signalwireSpaceUrl: process.env.SIGNALWIRE_SPACE_URL }
);

export { client, RestClient };
