import { logDebug } from './utils';

const manifest = chrome.runtime.getManifest();
const settings = {
  client_id: manifest.oauth2.client_id,
  client_secret: 'usq5dT6yGdw6sjdlE65XWHp5',
  redirect_uri: chrome.identity.getRedirectURL('provider_cb'),
};

const apiUrl = {
  webAuth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://www.googleapis.com/oauth2/v3/token',
  tokenInfo: 'https://www.googleapis.com/oauth2/v3/tokeninfo',
  calendar: 'https://www.googleapis.com/calendar/v3/calendars',
  calendarList: 'https://www.googleapis.com/calendar/v3/users/me/calendarList',
};

const getActualDate = () => new Date();

const getExpirationDate = (dateFrom: Date, expiration: number): number => {
  dateFrom.setMinutes(dateFrom.getMinutes() + expiration);

  return dateFrom.getTime();
};

/* ----------------------------------------------------- */

function initialize() {
  let params = `?client_id=${settings.client_id}`;
  params += `&scope=${manifest.oauth2.scopes.join(' ')}`;
  params += `&redirect_uri=${settings.redirect_uri}`;
  params += '&response_type=code'; // code - to get refresh and offline token?
  params += '&access_type=offline'; // offline not working with 'token' response type
  params += '&prompt=consent';

  chrome.identity.launchWebAuthFlow(
    {
      url: apiUrl.webAuth + params,
      interactive: true,
    },
    function(responseUrl) {
      if (responseUrl) {
        let code;

        // Get code from redirect url
        if (responseUrl.indexOf('=') >= 0) {
          // For chrome
          code = responseUrl.split('=')[1];
        }

        code = code.replace(/[#]/g, '');
        getTokens(code);
      } else {
        logDebug(chrome.runtime.lastError);
      }
    },
  );
}

function validateTokens() {
  fetch(`${apiUrl.tokenInfo}?access_token=${localStorage['access_token']}`, {
    method: 'GET',
  })
    .then(response => {
      if (response.status != 200) {
        revokeTokens();
      }
    })
    .catch(error => {
      logDebug(error);
    });
}

function revokeTokens() {
  let params = `?refresh_token=${localStorage['refresh_token']}`;
  params += `&client_id=${settings.client_id}`;
  params += `&client_secret=${settings.client_secret}`;
  params += '&grant_type=refresh_token';

  fetch(`${apiUrl.token}${params}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  })
    .then(response => response.json())
    .then(data => {
      localStorage['access_token'] = data.access_token;
      localStorage['expiration'] = getExpirationDate(getActualDate(), 45);
    })
    .catch(error => {
      logDebug(error);
    });
}

function getTokens(code: any) {
  let params = `?code=${code}`;
  params += `&client_id=${settings.client_id}`;
  params += `&client_secret=${settings.client_secret}`;
  params += `&redirect_uri=${settings.redirect_uri}`;
  params += '&grant_type=authorization_code';

  fetch(`${apiUrl.token}${params}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  })
    .then(response => response.json())
    .then(data => {
      localStorage['access_token'] = data.access_token;
      localStorage['refresh_token'] = data.refresh_token;
      localStorage['expiration'] = getExpirationDate(getActualDate(), 45);
    })
    .catch(error => {
      logDebug(error);
    });
}

/* ----------------------------------------------------- */

/**
 * Fetches event's data from Google Calendar API.
 * @returns {Promise.<Object>} event
 */
function getEventData(calendarId: string, eventId: string) {
  // Filter out default calendars, ie. Week number, Holidays
  if (!calendarId || calendarId.indexOf('#') > -1) {
    throw new Error(
      `Event '${eventId}' doesn't have proper calendar '${calendarId}'.`,
    );
  }

  let params = `/${calendarId}/events/${eventId}`;

  return fetch(apiUrl.calendar + params, {
    method: 'GET',
    headers: {
      Authorization: `Bearer  ${localStorage['access_token']}`,
    },
  })
    .then(response => response.json())
    .catch(error => {
      logDebug(error);
    });
}

/**
 * Sends event data back to calendar page.
 */
function sendEvent(event: Object, message: string) {
  // Do not send event without description
  if (!event.hasOwnProperty('description')) {
    return false;
  }

  chrome.tabs.query(
    {
      url: 'https://calendar.google.com/calendar*',
    },
    function(tabs) {
      for (let i = 0, len = tabs.length; i < len; i++) {
        chrome.tabs.sendMessage(tabs[i].id, {
          msg: message,
          event: event,
        });
      }
    },
  );
}

/* ----------------------------------------------------- */

chrome.runtime.onInstalled.addListener(function(details) {
  if (details.reason === 'install') {
    initialize();
  }
});

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.msg === 'events') {
    if (
      typeof localStorage['expiration'] === 'undefined' ||
      localStorage['expiration'] < new Date().getTime()
    ) {
      revokeTokens();
    }

    const events = request.events;
    const calendars = JSON.parse(localStorage['calendars']);

    for (let i = 0, len = events.length; i < len; i++) {
      const calendar = calendars[events[i].calendarName];

      getEventData(calendar, events[i].id)
        .then(event => {
          sendEvent(event, 'showEvent');
        })
        .catch(error => {
          logDebug(error);
        });
    }
  }
});

const parseCalendarList = (calendarList: any[]) => {
  return calendarList.reduce((list, calendar) => {
    list[calendar.summary] = calendar.id;
    return list;
  }, {});
};

const getCalendarList = () => {
  fetch(apiUrl.calendarList, {
    method: 'GET',
    headers: {
      Authorization: 'Bearer  ' + localStorage['access_token'],
    },
  })
    .then(response => response.json())
    .then(data => parseCalendarList(data.items))
    .then(parsedData => {
      localStorage['calendars'] = JSON.stringify(parsedData);
    })
    .catch(error => {
      logDebug(error);
    });
};

getCalendarList();
