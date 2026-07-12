import { componentIds, StaticHeader, StaticComponent } from '../../ui/UI.js'
import { List } from '../../ui/utils/List.js'
import config from './LiveSplitsWidget.config.js'
import { Logger } from '../../../src/Logger.js'

export default class LiveSplitsWidget extends StaticComponent {
  private readonly header: StaticHeader
  // Updated cache definition to track the raw numerical milliseconds
  private readonly liveSessionCache: Map<string, { mapId: string; time: string; rawTime?: number }> = new Map()
  //totalRunTimeCache 
  private readonly totalRunTimeCache: Map<string, string> = new Map()
  // Maintain a persistent layout array that never drops or alters indexes during the match
  private frozenPlaylist: tm.Map[] = []
  // Tracks exactly which track index slot in the list is currently being played
  private currentPlaylistIndex: number = 0
  // Guard flag to ensure the jukebox collection capture routine happens exactly once on the first map switch
  private isPlaylistInitialized: boolean = false

  constructor() {
    super((componentIds as any).liveSplits ?? 123456)
    this.header = new StaticHeader('race')
 
    this.renderOnEvent('PlayerFinish', (info: tm.FinishInfo) => { 
      setTimeout(async () => {
        await this.initializeFromDatabase(info.login)
      }, 1000)
    })

    this.renderOnEvent('PlayerJoin', (info: tm.JoinInfo) => {
      this.initializeFromDatabase(info.login)
    })

    // Capture and lock down the timeline order upon the NEXT map start
    this.renderOnEvent('BeginMap', () => {
      if (!this.isPlaylistInitialized) {
        this.initializePlaylistOnMatchStart()
      } else {
        this.updateActivePlaylistPointer()
      }
      this.display()
    })

    this.onPanelHide((player) => {
      this.displayToPlayer(player.login)
    })
  }

  // Expanded height of the widget container to perfectly accommodate the extra total row
  getHeight(): number {
    return config.entryHeight * (config.entries + 1) + StaticHeader.raceHeight + config.margin
  }

  /**
   * Captures the entire chronological layout timeline exactly once on the next map load.
   */
  private initializePlaylistOnMatchStart(): void {
    this.frozenPlaylist = []
    this.currentPlaylistIndex = 0

    if (tm.maps.current) {
      this.frozenPlaylist.push(tm.maps.current)
    }

    for (const map of tm.jukebox.queue) {
      this.frozenPlaylist.push(map)
    }

    this.isPlaylistInitialized = true
  }

  /**
   * Matches the newly loaded map against our immutable frozen sequence array to pinpoint the current track index.
   */
  private updateActivePlaylistPointer(): void {
    if (!tm.maps.current) { return }
    
    const index = this.frozenPlaylist.findIndex(map => map.id === tm.maps.current.id)
    
    if (index !== -1) {
      this.currentPlaylistIndex = index
    } else {
      // Hard fallback: If an unpredicted map drops outside your locked layout array, force a fresh layout capture
      this.initializePlaylistOnMatchStart()
    }
  }

/**
 * Hydrates memory cache securely using internal map IDs and calculates total run time.
 */
private async initializeFromDatabase(login: string): Promise<void> {
  const playerObj = tm.players.get(login)
  if (playerObj === undefined) { return }

  // Query 1: Fetch individual map splits
  const splitQuery = `
    SELECT l.map_uid, l.finish_time 
    FROM livesplits l 
    INNER JOIN maps m ON m.id = l.map_id 
    WHERE l.player_login = $1;
  `
  // Query 2: Let the database handle the sum optimization natively
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

  // Process Split Data
  if (!(splitResult instanceof Error)) {
    for (const row of splitResult) {
      if (row.map_uid) {
        this.liveSessionCache.set(`${login}_${row.map_uid}`, {
          mapId: String(row.map_uid),
          time: row.finish_time !== null ? tm.utils.getTimeString(row.finish_time) : '-'
        })
      }
    }
  }

  // Process Total Runtime Query
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

  /**
   * Builds the localized component list utilizing a dynamic sliding layout window.
   */
  displayToPlayer(login: string): void | any {
    if (!this.isDisplayed) { return }
    if (this.hasPanelsHidden(login)) { return this.hideToPlayer(login) }

    const mapNames: string[] = []
    const finishTimes: string[] = []

    const MAX_VISIBLE_ENTRIES = 5
    const totalEntries = Math.min(this.frozenPlaylist.length, MAX_VISIBLE_ENTRIES)
    const renderCount = totalEntries > 0 ? totalEntries : 1

    // FIXED: Calculate sliding window index boundary limits
    // Centering offset defaults to 2 items behind the active index
    let startIndex = Math.max(0, this.currentPlaylistIndex - 2)
    
    // Safety clamp: Ensure sliding frame viewport bounds do not overshoot layout limits
    if (startIndex + MAX_VISIBLE_ENTRIES > this.frozenPlaylist.length) {
      startIndex = Math.max(0, this.frozenPlaylist.length - MAX_VISIBLE_ENTRIES)
    }

    for (let i = 0; i < renderCount; i++) {
      // Fetch item relative to calculated sliding viewport start position
      const absoluteMapIndex = startIndex + i
      const map = this.frozenPlaylist[absoluteMapIndex]
      
      if (map !== undefined) {
        const isCurrent = absoluteMapIndex === this.currentPlaylistIndex
        const isFinished = absoluteMapIndex < this.currentPlaylistIndex
        
        let displayName = map.name
        if (isCurrent) {
          displayName = `$F00» $FFF${map.name}` // Active track marker (Red arrow)
        } else if (isFinished) {
          displayName = `$888× $777${map.name}` // Completed map marker (Gray check)
        }
        
        mapNames.push(displayName)
        
        const cachedRecord = this.liveSessionCache.get(`${login}_${map.id}`)
        
        // Highlight active track split running timers in green ($0F0)
        const displayTime = cachedRecord 
          ? (isCurrent ? `$0F0${cachedRecord.time}` : cachedRecord.time) 
          : '-'
        
        finishTimes.push(displayTime)
      } else {
        mapNames.push('$888No Maps Juked')
        finishTimes.push(' ')
      }
    }

	const dynamicListHeight = config.entryHeight * renderCount
    const listUi = new List(renderCount, config.width, dynamicListHeight, config.columnProportions)
    const content = listUi.constructXml(mapNames, finishTimes)

    // Pull the computed DB aggregate value out directly
    const cachedTotal = this.totalRunTimeCache.get(login) ?? '-'
    const hasAnyFinishes = cachedTotal !== '-'

    // Render a single-row List helper that matches layout structure
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
        <frame posn="0 -${this.header.options.height + config.margin} 1">
        <quad bgcolor="0006"/>
          ${content}
          <!-- Places the total time directly below the dynamic split entries -->
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