import { JukeboxLoader } from "./Playlist.js" // Path to your loader script
import { Logger } from '../../src/Logger.js'

// Run once the framework components have fully initialized
tm.addListener("Startup", async () => {
	  Logger.info("Startup detected. Preparing jukebox queue initialization...")
	  const loader = new JukeboxLoader()
	  await loader.loadAllMapsSortedById() 
});