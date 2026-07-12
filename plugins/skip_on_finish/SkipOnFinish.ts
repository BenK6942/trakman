import config from './Config.js'

/**
 * Upon finish of map, skips to next challenge
 * @author benk
 */

if (config.isEnabled) {
    tm.addListener('PlayerFinish', (f) => {
        tm.client.call('NextChallenge');
    });
}