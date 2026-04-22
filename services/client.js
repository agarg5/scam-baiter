require('dotenv').config();
const { RestClient } = require('@signalwire/compatibility-api');

const client = RestClient(
  process.env.SIGNALWIRE_PROJECT_ID,
  process.env.SIGNALWIRE_API_TOKEN,
  { signalwireSpaceUrl: process.env.SIGNALWIRE_SPACE_URL }
);

module.exports = { client, RestClient };
