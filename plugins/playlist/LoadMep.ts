import { JukeboxLoader } from "./Playlist.js" // Path to your loader script
import { Logger } from '../../src/Logger.js'

import config from './Config.js'

/**
 * Upon finish of map, skips to next challenge
 * @author benk
 */

if (config.isEnabled) {
// Run once the framework components have fully initialized
tm.addListener("Startup", async () => {
	  Logger.info("Startup detected. Preparing jukebox queue initialization...")
	  const loader = new JukeboxLoader()
	  await loader.loadAllMapsSortedById() 
});
}