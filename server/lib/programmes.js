'use strict';

const RETIRED_PROGRAMME_ID = 'greatness-32-days';
const RETIRED_PROGRAMME_TYPE = '32_days';

function isRetiredProgramme(id, type) {
  return id?.toLowerCase() === RETIRED_PROGRAMME_ID || type?.toLowerCase() === RETIRED_PROGRAMME_TYPE;
}

module.exports = { RETIRED_PROGRAMME_ID, RETIRED_PROGRAMME_TYPE, isRetiredProgramme };
