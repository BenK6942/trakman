import config from './Config.js'
import { Logger } from '../../src/Logger.js'
import { LiveSplitsRepository } from './LiveSplitsRepository.js'

/**
 * Upon finish of map, writes livesplit data to database
 * @author benk
 */

const liveSplitsRepo = new LiveSplitsRepository()

let startTime: number = 0
let endTime: number = 0
let splitTime: number = 0
let splitTimeMinus321go: number = 0
let isMapActive: boolean = false
let playerSpecStatus: boolean = true

if (config.isEnabled) {
		tm.addListener('TrackMania.PlayerInfoChanged', (PlayerInfo) => { 
			Logger.info(`spectator status: ${PlayerInfo.SpectatorStatus}`)
			if (PlayerInfo.SpectatorStatus == 0) {
				playerSpecStatus = false
			}
			if (PlayerInfo.SpectatorStatus !== 0) {
				playerSpecStatus = true
			}
		})
			
		tm.addListener('TrackMania.PlayerFinish', async ([, login_param, time_param]) => {
			Logger.info(`time_param: ${time_param}, startTime: ${startTime}`)
			if (time_param == 0 && !isMapActive && !playerSpecStatus) {
				//when player is able to start playing (after "please wait")
				startTime = Date.now()
				isMapActive = true
			}
			else if (time_param > 0) {
				endTime = Date.now()
				splitTime = endTime - startTime
				splitTimeMinus321go = splitTime - 2500
				if ((splitTimeMinus321go - 3000) < time_param) {
					//no reset, use more accurate time_param
					splitTimeMinus321go = time_param 
				}
				Logger.info(`splits values: finish_time: ${time_param}, splitTimeMinus321go: ${splitTimeMinus321go}, splitTime: ${splitTime}`)
				try {
					const currentMapUid  = tm.maps.current.id 
					await liveSplitsRepo.addOrUpdate(currentMapUid, login_param, splitTimeMinus321go, splitTimeMinus321go)
				}
				catch (error) {
					Logger.error(`Failed to insert record: ${(error as Error).message}`)
				}
				isMapActive = false
			}
	})
}