import { componentIds, StaticHeader, StaticComponent, addManialinkListener, centeredText } from '../../ui/UI.js'
import { List } from '../../ui/utils/List.js'
import config from './LiveSplitsWidget.config.js'
import { Logger } from '../../../src/Logger.js'
import { MapPacksRepository } from '../MapPacksRepository.js'
import { MapPackPbSplitsRepository } from '../MapPackPbSplitsRepository.js'
import { PlayerRepository } from '../../../src/database/PlayerRepository.js'

// Action ID for the embedded map packs button
const BUTTON_ACTION_ID = 8_100_000

interface CumulativeSplitData {
  mapPackId: number
  mapId: number
  mapUid: string
  mapOrder: number
  mapTime: number
  cumulativeTime: number
}

export default class LiveSplitsWidget extends StaticComponent {
  private readonly header: StaticHeader
  
  // Cache for dynamic active run times
  private readonly liveSessionCache: Map<string, { mapId: string; time: string; rawTime?: number }> = new Map()
  
  // STATIC CACHE: Captures the player's PB exactly once when they join or at startup
  private readonly frozenPBCache: Map<string, number> = new Map()

  // Cache for cumulative PB splits fetched from v_pb_cumulative_splits
  private readonly cumulativePbCache: Map<string, CumulativeSplitData> = new Map()

  // Cache for the aggregate run time
  private readonly totalRunTimeCache: Map<string, { rawMs: number; formatted: string }> = new Map()
  
  private readonly pbTotalCache: Map<string, { rawMs: number; formatted: string }> = new Map()
  private readonly sumOfBestCache: Map<string, { rawMs: number; formatted: string }> = new Map()

  // Maintain a persistent layout array that never drops or alters indexes during the match
  private frozenPlaylist: tm.Map[] = []
  private currentPlaylistIndex: number = 0
  private isPlaylistInitialized: boolean = false
  private currentMapPackId: number = 0
  private mapPackName: string = 'No Map Pack Juked'

  private hasRequeuedLastMap: boolean = false
  private mapPackCompletion: boolean = false

  constructor() {
    super((componentIds as any).liveSplits ?? 123456)
    this.header = new StaticHeader('race')

    // Click listener for the embedded Packs button
    addManialinkListener(BUTTON_ACTION_ID, (info): void => {
      const alias = 'packs'
      const command = tm.commands.list.find(c => c.aliases.includes(alias))
      
      if (command) {
        const player = tm.players.get(info.login)
        if (!player) return

        const commandContext = {
          ...player,
          text: `/${alias}`,
          date: new Date(),
          aliasUsed: alias
        }

        void command.callback(commandContext, [])
      }
    })

    // Initial hydration for any players already on the server when the plugin starts/reloads
    for (const player of tm.players.list) {
      this.fetchAndFreezePBs(player.login)
      this.initializeFromDatabase(player.login)
    }

    this.renderOnEvent('PlayerFinish', (info: tm.FinishInfo) => { 
      setTimeout(async () => { 
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

    tm.commands.add({
      aliases: [`ip`, `initializePlaylist`],
      help: `LiveSpitsWidget: Initialize playlist.`, 
      callback: async (info: tm.MessageInfo) => {
        this.isPlaylistInitialized = false 
        this.mapPackCompletion = false
        this.renderOnEvent('BeginMap', () => {
          if (this.mapPackCompletion) {
            setTimeout(async () => {
              await this.initializeFromDatabase(info.login)
            }, 1000)
            return
          }
          if (!this.isPlaylistInitialized) {
            this.initializePlaylist()          
            setTimeout(async () => {
              await this.fetchAndCacheCumulativePBsForPlayer(info.login)
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
    }) 
    
    this.onPanelHide((player) => {
      this.displayToPlayer(player.login)
    })
  }

  getHeight(): number {
    // Height adjusted to fit Header + Map Pack Name + Splits + Summary + Gap + Button
    return config.entryHeight * (config.entries + 5.25) + StaticHeader.raceHeight + (config.margin * 4)
  }

  private trimTimeStr(timeStr: string): string {
    return timeStr.replace(/^(\$[A-Fa-f0-9]{3})?([+-])?0:0?/i, '$1$2')
  }

  private initializePlaylist(): void {
    this.frozenPlaylist = []
    this.currentPlaylistIndex = 0
    this.hasRequeuedLastMap = false
    this.mapPackName = 'Custom Playlist'
    
    tm.db.query(`UPDATE livesplits SET map_pack_id = NULL,finish_time = NULL;`)

    if (tm.maps.current) {
      this.frozenPlaylist.push(tm.maps.current)
    }

    for (const entry of tm.jukebox.juked) {
      this.frozenPlaylist.push(entry.map)
    }

    this.isPlaylistInitialized = true

    const mapPacksRepo = new MapPacksRepository()
    try { 
      mapPacksRepo.insertIntoMapPacksTable(this.frozenPlaylist)
    } catch (error) {
      Logger.error(`Failed to insert record: ${(error as Error).message}`)
    } 
  }
  
  private async fetchAndCacheCumulativePBsForPlayer(login: string): Promise<void> {
    const query = `
      SELECT 
        v.map_pack_id,
        v.player_id,
        v.player_login,
        v.map_order,
        v.map_id,
        v.map_uid,
        v.map_time,
        v.cumulative_time
      FROM v_pb_cumulative_splits v
      JOIN livesplits l 
        ON v.map_pack_id = l.map_pack_id 
       AND v.map_id = l.map_id
       AND v.player_login = l.player_login
      WHERE l.map_pack_id IS NOT NULL
        AND l.player_login = $1;
    `

    const result = await tm.db.query(query, login)

    if (!(result instanceof Error)) {
      for (const row of result) {
        const key = `${row.player_login}_${row.map_uid}`
        this.cumulativePbCache.set(key, {
          mapPackId: Number(row.map_pack_id),
          mapId: Number(row.map_id),
          mapUid: String(row.map_uid),
          mapOrder: Number(row.map_order),
          mapTime: Number(row.map_time),
          cumulativeTime: Number(row.cumulative_time)
        })
      }
    }
  } 

  private getCumulativeDelta(login: string, mapUid: string, cumulativeRunMs: number): { diffMs: number; formatted: string } | null {
    const pbSplit = this.cumulativePbCache.get(`${login}_${mapUid}`)

    if (!pbSplit || cumulativeRunMs === 0) {
      return null
    }

    const diffMs = cumulativeRunMs - pbSplit.cumulativeTime
    const sign = diffMs > 0 ? '$F00+' : diffMs <= 0 ? '$0F0-' : '$888'
    const formatted = this.trimTimeStr(`${sign}${tm.utils.getTimeString(Math.abs(diffMs))}`)

    return { diffMs, formatted }
  }

  private getCumulativeRunTimeUpToIndex(login: string, targetIndex: number): number {
    let sum = 0
    for (let i = 0; i <= targetIndex; i++) {
      const map = this.frozenPlaylist[i]
      if (!map) continue
      const record = this.liveSessionCache.get(`${login}_${map.id}`)
      if (record?.rawTime !== undefined) {
        sum += record.rawTime
      } else {
        return 0 
      }
    }
    return sum
  }

  private updateActivePlaylistPointer(): void {
    if (!tm.maps.current) { return }
    
    const index = this.frozenPlaylist.findIndex(map => map.id === tm.maps.current.id)
    
    if (index !== -1) {
      this.currentPlaylistIndex = index

      const isLastMap = this.currentPlaylistIndex === this.frozenPlaylist.length - 1
      if (isLastMap && this.frozenPlaylist.length > 0 && !this.hasRequeuedLastMap) {
        this.requeueLastMapOnce(tm.maps.current)
      }
    } else {
      this.initializePlaylist()
    }
  }

  private requeueLastMapOnce(map: tm.Map): void {
    const isAlreadyNext = tm.jukebox.juked[0]?.map.id === map.id
    if (!isAlreadyNext) {
      tm.jukebox.add(map.id, undefined)
      Logger.info(`[LiveSplitsWidget] Re-queued last playlist map once: ${map.name} (${map.id})`)
    }
    this.hasRequeuedLastMap = true
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

    const pbQuery = `
      SELECT pb_total_run_time 
      FROM v_pb_splits_total 
      WHERE player_login = $1 
        AND map_pack_id = (SELECT map_pack_id FROM livesplits WHERE player_login = $1 AND map_pack_id IS NOT NULL LIMIT 1);
    `
    const sobQuery = `
      SELECT SUM(personal_best_time) as sum_of_best
      FROM livesplits
      WHERE player_login = $1 
        AND map_pack_id = (SELECT map_pack_id FROM livesplits WHERE player_login = $1 AND map_pack_id IS NOT NULL LIMIT 1);
    `
    const packNameQuery = `
      SELECT map_pack_name 
      FROM map_packs mp 
      JOIN livesplits l 
        ON mp.map_pack_id = l.map_pack_id
      WHERE l.player_login = $1 AND l.map_pack_id IS NOT NULL
      LIMIT 1;
    `

    const [splitResult, totalResult, pbResult, sobResult, packNameResult] = await Promise.all([
      tm.db.query(splitQuery, login),
      tm.db.query(totalQuery, login),
      tm.db.query(pbQuery, login),
      tm.db.query(sobQuery, login),
      tm.db.query(packNameQuery, login)
    ])

    if (!(packNameResult instanceof Error) && packNameResult.length > 0 && packNameResult[0].map_pack_name) {
      this.mapPackName = String(packNameResult[0].map_pack_name)
    }

    if (!(splitResult instanceof Error)) {
      for (const row of splitResult) {
        if (row.map_uid) {
          this.liveSessionCache.set(`${login}_${row.map_uid}`, {
            mapId: String(row.map_uid),
            time: row.finish_time !== null ? this.trimTimeStr(tm.utils.getTimeString(row.finish_time)) : '-',
            rawTime: row.finish_time !== null ? Number(row.finish_time) : undefined
          })
        }
      }
    }

    if (!(totalResult instanceof Error) && totalResult.length > 0 && totalResult[0].total_time !== null) {
      const totalMs = Number(totalResult[0].total_time)
      this.totalRunTimeCache.set(login, { rawMs: totalMs, formatted: this.trimTimeStr(tm.utils.getTimeString(totalMs)) })
    } else {
      this.totalRunTimeCache.set(login, { rawMs: 0, formatted: '-' })
    }

    if (!(pbResult instanceof Error) && pbResult.length > 0 && pbResult[0].pb_total_run_time !== null) {
      const pbMs = Number(pbResult[0].pb_total_run_time)
      this.pbTotalCache.set(login, { rawMs: pbMs, formatted: this.trimTimeStr(tm.utils.getTimeString(pbMs)) })
    } else {
      this.pbTotalCache.set(login, { rawMs: 0, formatted: '-' })
    }

    if (!(sobResult instanceof Error) && sobResult.length > 0 && sobResult[0].sum_of_best !== null) {
      const sobMs = Number(sobResult[0].sum_of_best)
      this.sumOfBestCache.set(login, { rawMs: sobMs, formatted: this.trimTimeStr(tm.utils.getTimeString(sobMs)) })
    } else {
      this.sumOfBestCache.set(login, { rawMs: 0, formatted: '-' })
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
          displayName = `$777${tm.utils.strip(map.name)}`
        }
          
        let diffDisplay = '       '
        
        const mapCumulativeRunMs = this.getCumulativeRunTimeUpToIndex(login, absoluteMapIndex)
        const splitDiff = this.getCumulativeDelta(login, map.id, mapCumulativeRunMs)?.formatted
        
        if (splitDiff !== undefined) { 
          diffDisplay = splitDiff
        }
        
        const cachedRecord = this.liveSessionCache.get(`${login}_${map.id}`)
        const frozenPbMs = this.frozenPBCache.get(`${login}_${map.id}`)

        if (cachedRecord?.rawTime !== undefined && frozenPbMs !== undefined) {
          const diff = cachedRecord.rawTime - frozenPbMs
          if (diff < 0) {
            diffDisplay = `$EB0${tm.utils.strip(diffDisplay, true)}`
          }
        }
          
        mapNames.push(`${diffDisplay}  ${displayName}`)

        const displayTime = cachedRecord 
          ? (isCurrent ? `${cachedRecord.time}` : cachedRecord.time) 
          : '-'
        
        finishTimes.push(displayTime)
      } else {
        mapNames.push('      $888-')
        finishTimes.push(' ')
      }
    }

    const dynamicListHeight = config.entryHeight * renderCount
    const listUi = new List(renderCount, config.width, dynamicListHeight, config.columnProportions)
    let content = listUi.constructXml(mapNames, finishTimes)
        content = content.replace(/text="\$s\d+"/g, 'text=""')
        
    const totalData = this.totalRunTimeCache.get(login)
    const pbData = this.pbTotalCache.get(login)
    const sobData = this.sumOfBestCache.get(login)
    
    const hasAnyFinishes = totalData !== undefined && totalData.formatted !== '-'
    const cachedTotalFormatted = totalData?.formatted ?? '-'
    const pbFormatted = pbData?.rawMs ? pbData.formatted : '-'
    const sobFormatted = sobData?.rawMs ? sobData.formatted : '-'

    const totalLabels = ['$BBBTotal run time', '$BBBPersonal best', '$BBBSum of best']
    const totalValues = [
      hasAnyFinishes ? `${cachedTotalFormatted}` : '$888-',
      pbData && pbData.rawMs > 0 ? `${pbFormatted}` : '$888-',
      sobData && sobData.rawMs > 0 ? `${sobFormatted}` : '$888-'
    ]

    let totalContent = ''
    for (let i = 0; i < 3; i++) {
      const yOffset = i * config.entryHeight
      totalContent += `<label posn="1 -${yOffset + 0.3} 2" sizen="10 2" textsize="1" text="${totalLabels[i]}"/>`
      totalContent += `<label posn="${(config.width || 14.675) - 0.5} -${yOffset + 0.3} 2" sizen="6 2" halign="right" textsize="1" text="${totalValues[i]}"/>`
    }

    // Row Dimensions
    const widgetWidth = config.width || 14.675
    const buttonRowHeight = config.entryHeight
    const packNameRowHeight = config.entryHeight
    const iconSize = buttonRowHeight - 0.5
    const buttonGap = config.margin * 1.5

    // Map Pack Name Row XML (Top of LiveSplits container)
    const packNameText = tm.utils.safeString(tm.utils.strip(this.mapPackName, false))
    const mapPackNameRowXml = `
      <frame posn="0 0 2">
        <quad posn="0 0 1" sizen="${widgetWidth} ${packNameRowHeight}" bgcolor="0004"/>
        <label posn="${widgetWidth / 2} -${packNameRowHeight / 2} 2" 
              sizen="${widgetWidth - 0.8} ${packNameRowHeight}" 
              halign="center" 
              valign="center" 
              textscale="0.65" 
              autoscale="1"
              textsize="1" 
              text="${packNameText}"/>
      </frame>`

    // Layout Offsets
    const listStartY = packNameRowHeight + config.margin
    const summaryStartY = listStartY + dynamicListHeight + config.margin
    const totalRunTimeHeight = (config.entryHeight * 3) + config.margin
    const mainContainerHeight = packNameRowHeight + dynamicListHeight + totalRunTimeHeight + (config.margin * 2)

    // Embedded Map Packs Button Row XML (At bottom separated by buttonGap)
    const buttonStartY = mainContainerHeight + buttonGap
    const buttonRowXml = `
      <frame posn="0 -${buttonStartY} 2">
        <quad posn="0 0 1" sizen="${widgetWidth} ${buttonRowHeight}" bgcolor="0006" action="${BUTTON_ACTION_ID}"/>
        <quad posn="0.3 -0.25 2" sizen="${iconSize} ${iconSize}" image="${config.buttonIcon}"/>
        <frame posn="${iconSize + 0.6} 0 2">
          ${centeredText('Map Packs', widgetWidth - iconSize - 0.6, buttonRowHeight, { textScale: 1 })}
        </frame>
      </frame>`

    const xml = `<manialink id="${this.id}">
    <frame posn="${this.positionX} ${this.positionY} 1">
      <format textsize="1" textcolor="FFFF"/> 
        ${this.header.constructXml(config.title, config.icon, this.side)}

        <!-- Main LiveSplits Container Background -->
        <quad posn="0 -${this.header.options.height + config.margin} 1" sizen="${widgetWidth} ${mainContainerHeight}" bgcolor="0006"/>

        <frame posn="0 -${this.header.options.height + config.margin} 1">
          
          <!-- Map Pack Name Row -->
          ${mapPackNameRowXml}

          <!-- Splits List -->
          <frame posn="0 -${listStartY} 1">
            ${content}
          </frame>
          
          <!-- Summary Section -->
          <frame posn="0 -${summaryStartY} 1">
            <quad posn="0.5 0 2" sizen="${widgetWidth - 1} 0.1" bgcolor="8886"/>
            <frame posn="0 -${config.margin * 1.5} 1">
              ${totalContent}
            </frame>
          </frame>

          <!-- Embedded Map Packs Button (Separated at bottom) -->
          ${buttonRowXml}

        </frame>
      </frame>
    </manialink>`

    tm.sendManialink(xml, login)
  }

  protected onPositionChange(): void {
    this.display()
  }
}