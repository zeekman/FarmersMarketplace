/**
 * Services index file
 * Exports all service classes
 */

const WaitlistService = require('./WaitlistService');
const AutomaticOrderProcessor = require('./AutomaticOrderProcessor');

module.exports = {
  WaitlistService,
  AutomaticOrderProcessor,
};
