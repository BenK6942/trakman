import { componentIds, StaticHeader, StaticComponent } from '../../ui/UI.js'
import { List } from '../../ui/utils/List.js'
import config from './LiveSplitsWidget.config.js'
import { Logger } from '../../../src/Logger.js'
import { MapPacksRepository } from '../MapPacksRepository.js'
import { MapPackPbSplitsRepository } from '../MapPackPbSplitsRepository.js'
import { PlayerRepository } from '../../../src/database/PlayerRepository.js'

export default class LiveSplitsWidget extends StaticComponent {
  private readonly header: StaticHeader
  
  // Cache for dynamic active run times
  private readonly liveSessionCache: Map<string, { mapId: string; time: string; rawTime?: number }> = new Map()
  
  // STATIC CACHE: Captures the player's PB exactly once when they join or at startup
  private readonly frozenPBCache: Map<string, number> = new Map()
  
  // Cache for the aggregate run time
  private readonly totalRunTimeCache: Map<string, string> = new Map()
  
  // Maintain a persistent layout array that never drops or alters indexes during the match
  private frozenPlaylist: tm.Map[] = []
  private currentPlaylistIndex: number = 0
  private isPlaylistInitialized: boolean = false
  private currentMapPackId: number = 0

  // [MODIFIED] Flag to ensure the last map is only re-queued exactly once per playlist
  private hasRequeuedLastMap: boolean = false

  private mapPackCompletion: boolean = false

  constructor() {
    super((componentIds as any).liveSplits ?? 123456)
    this.header = new StaticHeader('race')

    // Initial hydration for any players already on the server when the plugin starts/reloads
    for (const player of tm.players.list) {
      this.fetchAndFreezePBs(player.login)
      this.initializeFromDatabase(player.login)
    }
 
    this.renderOnEvent('PlayerFinish', (info: tm.FinishInfo) => { 
      setTimeout(async () => { 
        // Check if the current map is the last map in the frozen playlist
        const isLastMap = this.currentPlaylistIndex === this.frozenPlaylist.length - 1
        if (!this.mapPackCompletion && isLastMap && this.frozenPlaylist.length > 0) {
          await this.checkPlaylistCompletion(info.login)
        }
        
        await this.initializeFromDatabase(info.login)
      }, 1000)
    })

    this.renderOnEvent('PlayerJoin', (info: tm.JoinInfo) => {
      this.fetchAndFreezePBs(info.login)
      this.initializeFromDatabase(info.login)
    })

    tm.commands.add(
      {
        aliases: [`ip`, `initializePlaylist`],
        help: `LiveSpitsWidget: Initialize playlist.`, 
        callback: async (info: tm.MessageInfo) => {
          this.isPlaylistInitialized = false
          this.mapPackCompletion = false
          this.renderOnEvent('BeginMap', () => {
            // Stop processing if map pack is already complete
            if (this.mapPackCompletion) {
              setTimeout(async () => {
                await this.initializeFromDatabase(info.login)
              }, 1000)
              return
            }
            if (!this.isPlaylistInitialized) {
              this.initializePlaylist()          
              setTimeout(async () => {
                await this.initializeFromDatabase(info.login)
              }, 1000)
            } else {
              this.updateActivePlaylistPointer()
            }
            this.display()
          })
          setTimeout(async () => {
            await this.initializeFromDatabase(info.login)
          }, 1000)
        },
        privilege: 1
      }
    ) 

    this.onPanelHide((player) => {
      this.displayToPlayer(player.login)
    })
  }

  getHeight(): number {
    return config.entryHeight * (config.entries + 1) + StaticHeader.raceHeight + config.margin
  }

  private initializePlaylist(): void {
    this.frozenPlaylist = []
    this.currentPlaylistIndex = 0
    this.hasRequeuedLastMap = false // [MODIFIED] Reset flag when a new playlist is initialized
    
    tm.db.query(`UPDATE livesplits SET map_pack_id = NULL,finish_time = NULL;`)

    if (tm.maps.current) {
      this.frozenPlaylist.push(tm.maps.current)
    }

    for (const entry of tm.jukebox.juked) {
      this.frozenPlaylist.push(entry.map)
    }

    this.isPlaylistInitialized = true

    //query to search if array of maps exists in mappacks, 
    // if insert succeeds into mappacks get new value for mappackid to insert into livesplits for each map to be played
    // if insert fails (as in mappack already exists) set current mappackid in livesplits for each map to be played

    const mapPacksRepo = new MapPacksRepository()
    try { 
      mapPacksRepo.insertIntoMapPacksTable(this.frozenPlaylist)
    }
    catch (error) {
      Logger.error(`Failed to insert record: ${(error as Error).message}`)
    } 
  }

  // [MODIFIED] Checks for last map and ensures it only re-queues once
  private updateActivePlaylistPointer(): void {
    if (!tm.maps.current) { return }
    
    const index = this.frozenPlaylist.findIndex(map => map.id === tm.maps.current.id)
    
    if (index !== -1) {
      this.currentPlaylistIndex = index

      // [MODIFIED] Re-queue only if it's the last map AND hasn't been re-queued yet
      const isLastMap = this.currentPlaylistIndex === this.frozenPlaylist.length - 1
      if (isLastMap && this.frozenPlaylist.length > 0 && !this.hasRequeuedLastMap) {
        this.requeueLastMapOnce(tm.maps.current)
      }
    } else {
      this.initializePlaylist()
    }
  }

  // [MODIFIED] Re-queues the last map and flips the flag to prevent infinite loops
  private requeueLastMapOnce(map: tm.Map): void {
    const isAlreadyNext = tm.jukebox.juked[0]?.map.id === map.id
    if (!isAlreadyNext) {
      tm.jukebox.add(map.id, undefined)
      Logger.info(`[LiveSplitsWidget] Re-queued last playlist map once: ${map.name} (${map.id})`)
    }
    this.hasRequeuedLastMap = true // Mark as done so it won't re-queue again
  }

  private async onPlaylistFinished(login: string, isNewPb: boolean): Promise<void> {
    this.mapPackCompletion = true
    if (isNewPb) {
      tm.sendMessage(`$0F0[LiveSplits] $FFFPlayer $0F0${login} $FFFset a new Map Pack Personal Best!`)
      Logger.info(`[LiveSplitsWidget] New PB stored in map_pack_pb_splits for player ${login}`)
    } else {
      tm.sendMessage(`$0F0[LiveSplits] $FFFPlayer $0F0${login} $FFFcompleted the map pack run.`)
    }
  }

  private async checkPlaylistCompletion(login: string): Promise<void> {
    const playerRepo = new PlayerRepository()
    const playerId = await playerRepo.getId(login)
    if (playerId === undefined) {
        Logger.error(`[LiveSplits] Failed to look up player id: ${login}`)
        return
    }
    const mapPackPbSplitsRepo = new MapPackPbSplitsRepository()
    const isNewPb = await mapPackPbSplitsRepo.saveMapPackPbIfBest(playerId)
    await this.onPlaylistFinished(login, isNewPb)
  }

  private async fetchAndFreezePBs(login: string): Promise<void> {
    const query = `
      SELECT map_uid, personal_best_time 
      FROM livesplits 
      WHERE player_login = $1 AND personal_best_time IS NOT NULL;
    `
    const result = await tm.db.query(query, login)

    if (!(result instanceof Error)) {
      for (const row of result) {
        if (row.map_uid) {
          this.frozenPBCache.set(`${login}_${row.map_uid}`, Number(row.personal_best_time))
        }
      }
    }
  }

  private async initializeFromDatabase(login: string): Promise<void> {
    const playerObj = tm.players.get(login)
    if (playerObj === undefined) { return }

    const splitQuery = `
      SELECT l.map_uid, l.finish_time 
      FROM livesplits l 
      INNER JOIN maps m ON m.id = l.map_id 
      WHERE l.player_login = $1;
    `
    const totalQuery = `
      SELECT SUM(COALESCE(l.finish_time,0)) as total_time
      FROM livesplits l
      INNER JOIN maps m ON m.id = l.map_id
      WHERE l.player_login = $1;
    `

    const [splitResult, totalResult] = await Promise.all([
      tm.db.query(splitQuery, login),
      tm.db.query(totalQuery, login)
    ])

    if (!(splitResult instanceof Error)) {
      for (const row of splitResult) {
        if (row.map_uid) {
          this.liveSessionCache.set(`${login}_${row.map_uid}`, {
            mapId: String(row.map_uid),
            time: row.finish_time !== null ? tm.utils.getTimeString(row.finish_time) : '-',
            rawTime: row.finish_time !== null ? Number(row.finish_time) : undefined
          })
        }
      }
    }

    if (!(totalResult instanceof Error) && totalResult.length > 0 && totalResult[0].total_time !== null) {
      const totalMs = Number(totalResult[0].total_time)
      this.totalRunTimeCache.set(login, tm.utils.getTimeString(totalMs))
    } else {
      this.totalRunTimeCache.set(login, '-')
    }

    this.displayToPlayer(login)
  }

  display() {
    if (!this.isDisplayed) { return }
    for (const player of tm.players.list) {
      this.displayToPlayer(player.login)
    }
  }

  displayToPlayer(login: string): void | any {
    if (!this.isDisplayed) { return }
    if (this.hasPanelsHidden(login)) { return this.hideToPlayer(login) }

    const mapNames: string[] = []
    const finishTimes: string[] = []

    const MAX_VISIBLE_ENTRIES = 5
    const totalEntries = Math.min(this.frozenPlaylist.length, MAX_VISIBLE_ENTRIES)
    const renderCount = totalEntries > 0 ? totalEntries : 1

    let startIndex = Math.max(0, this.currentPlaylistIndex - 2)
    if (startIndex + MAX_VISIBLE_ENTRIES > this.frozenPlaylist.length) {
      startIndex = Math.max(0, this.frozenPlaylist.length - MAX_VISIBLE_ENTRIES)
    }

    for (let i = 0; i < renderCount; i++) {
      const absoluteMapIndex = startIndex + i
      const map = this.frozenPlaylist[absoluteMapIndex]
      
      if (map !== undefined) {
        const isCurrent = absoluteMapIndex === this.currentPlaylistIndex
        const isFinished = absoluteMapIndex < this.currentPlaylistIndex
        
        let displayName = map.name
        if (isCurrent) {
          displayName = `$F00» $FFF${map.name}`
        } else if (isFinished) {
          displayName = ` $777${map.name}`
        }
        
        const cachedRecord = this.liveSessionCache.get(`${login}_${map.id}`)
        const frozenPbMs = this.frozenPBCache.get(`${login}_${map.id}`)
        
        let diffDisplay = '       ' // Default spacing for un-run maps
        if (cachedRecord?.rawTime !== undefined && frozenPbMs !== undefined) {
          const diff = cachedRecord.rawTime - frozenPbMs
          if (diff > 0) {
            diffDisplay = `$F00+${tm.utils.getTimeString(diff)}`
          } else if (diff < 0) {
            diffDisplay = `$0F0-${tm.utils.getTimeString(Math.abs(diff))}`
          } else {
            diffDisplay = `$888${tm.utils.getTimeString(0)}`
          }
        }
        
        // Merge the difference block directly into the display name string
        mapNames.push(`${diffDisplay}  ${displayName}`)

        const displayTime = cachedRecord 
          ? (isCurrent ? `$0F0${cachedRecord.time}` : cachedRecord.time) 
          : '-'
        
        finishTimes.push(displayTime)
      } else {
        mapNames.push('      $888No Maps Juked')
        finishTimes.push(' ')
      }
    }

    const dynamicListHeight = config.entryHeight * renderCount
    const listUi = new List(renderCount, config.width, dynamicListHeight, config.columnProportions)
    
    const content = listUi.constructXml(mapNames, finishTimes)

    const cachedTotal = this.totalRunTimeCache.get(login) ?? '-'
    const hasAnyFinishes = cachedTotal !== '-'

    const totalRunTimeHeight = config.entryHeight
    const totalListUi = new List(1, config.width, totalRunTimeHeight, config.columnProportions)
    
    const totalContent = totalListUi.constructXml(
      ['$BBBTotal run time'],
      [hasAnyFinishes ? `$0F0${cachedTotal}` : '$888-']
    )
  
    const xml = `<manialink id="${this.id}">
    <frame posn="${this.positionX} ${this.positionY} 1">
      <format textsize="1" textcolor="FFFF"/> 
        ${this.header.constructXml(config.title, config.icon, this.side)}
        <quad posn="0 -${this.header.options.height + config.margin} 1" sizen="14.675 13" bgcolor="0006"/>
        <frame posn="0 -${this.header.options.height + config.margin} 1">
          ${content}
          <frame posn="0 -${dynamicListHeight} 1">
            ${totalContent}
          </frame>
        </frame>
      </frame>
    </manialink>`

    tm.sendManialink(xml, login)
  }

  protected onPositionChange(): void {
    this.display()
  }
}