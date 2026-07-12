import { MapIdsRepository } from '../../src/database/MapIdsRepository.js'
import { Logger } from '../../src/Logger.js'

export class JukeboxLoader {
  private mapIdsRepo: MapIdsRepository;

  constructor() {
    this.mapIdsRepo = new MapIdsRepository();
  }

  // Helper utility to throttle XML-RPC network floods
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async loadAllMapsSortedById(): Promise<void> {
    try {
      // 1. Get all map data from framework cache 
      const currentMaps = tm.maps.list; 
      const uids = currentMaps.map(map => (map as any).id).filter(Boolean);

      if (uids.length === 0) {
        Logger.info("No maps found in the framework memory.");
        return;
      }

      // 2. Fetch tracking IDs using chunked splitGet
      Logger.info(`Fetching database IDs for ${uids.length} maps...`);
      const mapRecords = await this.mapIdsRepo.splitGet(uids);

      // 3. Sort sequentially by database ID (Ascending)
      mapRecords.sort((a, b) => a.id - b.id);

      Logger.info(`Loading ${mapRecords.length} maps into jukebox with a 75ms anti-flood delay...`);

      // 4. Rate-limited sequential jukebox insertion loop
      let addedCount = 0;
      for (const map of mapRecords) {
        try {
          await tm.jukebox.add(map.uid);
          Logger.trace(`[DB-ID: ${map.id}] Jukebox added: ${map.uid}`);
          addedCount++;
          
          // CRITICAL: Force the loop to pause for 75 milliseconds.
          // This keeps the XML-RPC socket alive and stops the Dedicated Server from freezing.
          await this.sleep(75); 
          
        } catch (callError: any) {
          Logger.error(`Failed to add map ${map.uid} via XML-RPC:`, callError?.message ?? callError);
          // Wait slightly longer if a network error hits to let the buffer clear
          await this.sleep(500); 
        }
      }

      Logger.info(`Successfully finished loading ${addedCount} maps sequentially without crashing the server.`);
    } catch (error: any) {
      Logger.error("Failed to execute rate-limited map loader:", error?.message ?? error);
    }
  }
}

