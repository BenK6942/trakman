import config from './Config.js' 
/**
 * Upon finish of map, skips to next challenge
 * @author benk
 */

if (config.isEnabled) {
    tm.addListener('TrackMania.PlayerFinish', async ([, , time_param]) => {
        if (time_param >0)
            tm.client.call('NextChallenge') 
    })
} 