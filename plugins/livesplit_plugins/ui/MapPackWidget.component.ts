import { centeredText, closeButton, Grid, componentIds, leftAlignedText, addManialinkListener, PopupWindow, Paginator, icons } from '../../ui/UI.js'
import { mappacks, type MapPack } from '../MapPacks.js'
import { MapPacksRepository } from '../MapPacksRepository.js'
import config from './MapPackWidget.config.js'

// Dedicated ID base to avoid collision with Maplist's 1,000,000 listener range
const MAPPACK_BASE_ID = 8_000_000

export default class MappackList extends PopupWindow<{ page: number, paginator: Paginator }> {
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private readonly paginator: Paginator
  private readonly packAddId: number = 1_000
  private readonly maxPackCount = 10_000
  private readonly grid: Grid
  private readonly packActionIds: number[] = []
  
  // Page navigation state tracking
  private readonly playerQueries: { paginator: Paginator, login: string }[] = []
  private readonly paginatorIdOffset: number = this.packAddId + this.maxPackCount
  private nextPaginatorId = 0

  // Track processing state and debounce listener timeouts
  private isProcessingPack: boolean = false
  private jukeboxTimeout: NodeJS.Timeout | null = null

  constructor() {
    super(MAPPACK_BASE_ID, config.icon, config.title, [])

    tm.commands.add({
      aliases: [`mp`, `loadMapPackIntoJukebox`],
      help: `MapPack: Load Maps in specified mappack into the jukebox. [map_pack_id]`,
      params: [{ name: 'mapPackId', type: 'int' }],
      callback: async (info: tm.MessageInfo, mapPackId: number): Promise<void> => {
        const mapPacksRepo = new MapPacksRepository()
        this.isProcessingPack = true
        try {
          await mapPacksRepo.addMapPackToJukebox(info.login, mapPackId)
        } finally {
          this.isProcessingPack = false
          this.reRender()
        }
      },
      privilege: 1
    })

    const initialPacks = mappacks.get()
    const pageCount: number = Math.max(1, Math.ceil(initialPacks.length / (config.rows * config.columns)))

    this.paginator = new Paginator(this.openId, this.contentWidth, this.footerHeight, pageCount)
    this.paginator.onPageChange = (login: string, page: number): void => {
      const pCount: number = Math.max(1, Math.ceil(mappacks.get().length / (config.rows * config.columns)))
      this.paginator.setPageCount(pCount)
      this.displayToPlayer(login, { page, paginator: this.paginator }, `${page}/${pCount}`)
    }

    this.grid = new Grid(this.contentWidth, this.contentHeight, new Array(config.columns).fill(1),
      new Array(config.rows).fill(1), config.grid)

    // Action listener using MAPPACK_BASE_ID
    addManialinkListener(this.openId + this.packAddId, this.maxPackCount, (info, packIndex): void => {
      const packId: number = this.packActionIds[packIndex]
      if (packId === undefined) return
      this.handlePackClick(packId, info.login, info.nickname)
    })

    tm.commands.add({
      aliases: config.commands.list.aliases,
      help: config.commands.list.help,
      params: [{ name: 'page', type: 'int', optional: true }],
      callback: (info: tm.MessageInfo, page?: number): void => {
        this.openOnPage(info.login, page ?? 1)
      },
      privilege: config.commands.list.privilege
    })
 
    tm.addListener('JukeboxChanged', (): void => {
      if (this.isProcessingPack) return

      if (this.jukeboxTimeout !== null) {
        clearTimeout(this.jukeboxTimeout)
      }

      this.jukeboxTimeout = setTimeout(() => {
        this.reRender()
        this.jukeboxTimeout = null
      }, 300)
    })
  }

  private getPaginator(login: string, packCount: number): Paginator {
    const pageCount: number = Math.max(1, Math.ceil(packCount / (config.rows * config.columns)))
    const playerQuery = this.playerQueries.find(a => a.login === login)
    let paginator: Paginator

    if (playerQuery !== undefined) {
      paginator = playerQuery.paginator
      paginator.setPageCount(pageCount)
    } else {
      paginator = new Paginator(this.openId + this.paginatorIdOffset + this.nextPaginatorId,
        this.windowWidth, this.footerHeight, pageCount)
      this.nextPaginatorId = (this.nextPaginatorId + 10) % 3000
      this.playerQueries.push({ paginator, login })
      paginator.onPageChange = (login: string, page: number): void => {
        const currentPCount = Math.max(1, Math.ceil(mappacks.get().length / (config.rows * config.columns)))
        this.displayToPlayer(login, { page, paginator }, `${page}/${currentPCount}`)
      }
    }
    return paginator
  }

  private getJukeboxIdentifiers(): Set<string> {
    const set = new Set<string>()
    const juked = tm.jukebox.juked ?? []

    for (const entry of juked as any[]) {
      if (entry?.map?.uid) set.add(String(entry.map.uid).trim())
      if (entry?.map?.id) set.add(String(entry.map.id).trim())
      if (entry?.uid) set.add(String(entry.uid).trim())
      if (entry?.id) set.add(String(entry.id).trim())
    }
    return set
  }

  private reRender(): void {
    const players: string[] = this.getPlayersWithWindowOpen()
    if (players.length === 0) return

    const packs = mappacks.get()
    const pageCount = Math.max(1, Math.ceil(packs.length / (config.rows * config.columns)))

    for (const login of players) {
      const obj = this.playerQueries.find(a => a.login === login)
      const paginator = obj?.paginator ?? this.paginator
      const page: number = paginator.getPageByLogin(login) ?? 1
      this.displayToPlayer(login, { page, paginator }, `${page}/${pageCount}`)
    }
  }

  async openOnPage(login: string, page: number): Promise<void> {
    const packs = await mappacks.fetch()
    const pageCount = Math.max(1, Math.ceil(packs.length / (config.rows * config.columns)))
    page = Math.min(pageCount, Math.max(1, page))

    const paginator = this.getPaginator(login, packs.length)
    paginator.setPageForLogin(login, page)
    this.displayToPlayer(login, { page, paginator }, `${page}/${pageCount}`)
  }

  protected async onOpen(info: tm.ManialinkClickInfo): Promise<void> {
    const packs = await mappacks.fetch()
    const pageCount: number = Math.max(1, Math.ceil(packs.length / (config.rows * config.columns)))
    const paginator = this.getPaginator(info.login, packs.length)
    const page: number = paginator.getPageByLogin(info.login) || 1

    this.displayToPlayer(info.login, { page, paginator }, `${page}/${pageCount}`)
  }

  protected onClose(info: tm.ManialinkClickInfo): void {
    const index: number = this.playerQueries.findIndex(a => a.login === info.login)
    if (index !== -1) {
      this.playerQueries[index].paginator.destroy()
      this.playerQueries.splice(index, 1)
    }
    this.hideToPlayer(info.login)
  }

  protected async constructContent(login: string, params?: { page: number }): Promise<string> {
    const packs: readonly Readonly<MapPack>[] = await mappacks.fetch()

    if (packs.length === 0) {
      return `<frame posn="0 0 1">
        ${centeredText('No map packs found in database.', this.contentWidth, this.contentHeight)}
      </frame>`
    }

    const startIndex: number = (config.rows * config.columns) * ((params?.page ?? 1) - 1)
    const packsToDisplay: number = Math.min(packs.length - startIndex, config.rows * config.columns)

    const jukedSet = this.getJukeboxIdentifiers()

    const cell = (i: number, j: number, w: number, h: number): string => {
      const gridIndex: number = (i * config.columns) + j
      const index: number = startIndex + gridIndex
      const pack = packs[index]

      if (!pack) return ''

      const packUids = (pack.mapUids ?? []).map(u => String(u).trim()).filter(u => u.length > 0)
      const isAllJuked = packUids.length > 0 && packUids.every(uid => jukedSet.has(uid))

      const actionId = this.getActionId(pack.id)
      const header: string = this.getHeader(index, actionId, isAllJuked, w, h)

      const rowH: number = (h - this.margin) / 3
      const width: number = (w - this.margin * 3) - config.iconWidth

      const rawName: string = pack.name ?? ''
      const sanitizedName: string = tm.utils.safeString(tm.utils.strip(rawName, false))
      const mapCount: number = pack.mapIds?.length ?? 0

      return `
        <frame posn="${this.margin} ${-this.margin} 3">
          <format textsize="1"/>
          ${header}

          <!-- Pack Name Row -->
          <frame posn="0 ${-rowH} 2">
            <quad posn="0 0 3" sizen="${config.iconWidth} ${rowH - this.margin}" bgcolor="${config.iconBackground}"/>
            <quad posn="${this.margin} ${-this.margin} 4" sizen="${config.iconWidth - this.margin * 2} ${rowH - this.margin * 3}" image="${config.icons[1]}"/>
            <frame posn="${config.iconWidth + this.margin} 0 2">
              <quad posn="0 0 2" sizen="${width} ${rowH - this.margin}" bgcolor="${config.contentBackground}"/>
              ${leftAlignedText(sanitizedName, width, rowH - this.margin, { textScale: config.textScale })}
            </frame>
          </frame>

          <!-- Map Count Row -->
          <frame posn="0 ${-rowH * 2} 2">
            <quad posn="0 0 3" sizen="${config.iconWidth} ${rowH - this.margin}" bgcolor="${config.iconBackground}"/>
            <quad posn="${this.margin} ${-this.margin} 4" sizen="${config.iconWidth - this.margin * 2} ${rowH - this.margin * 3}" image="${config.icons[2]}"/>
            <frame posn="${config.iconWidth + this.margin} 0 2">
              <quad posn="0 0 2" sizen="${width} ${rowH - this.margin}" bgcolor="${config.contentBackground}"/>
              ${leftAlignedText(`${config.texts.maps}${mapCount}`, width, rowH - this.margin, { textScale: config.textScale })}
            </frame>
          </frame>
        </frame>`
    }

    return this.grid.constructXml(new Array(packsToDisplay).fill(cell))
  }

  protected constructFooter(login: string, params?: { paginator: Paginator }): string {
    return closeButton(this.closeId, this.windowWidth, this.footerHeight) + (params?.paginator ?? this.paginator).constructXml(login)
  }

  private async handlePackClick(packId: number, login: string, nickname: string): Promise<void> {
    if (this.isProcessingPack) return

    if (this.jukeboxTimeout !== null) {
      clearTimeout(this.jukeboxTimeout)
    }
    const pack = mappacks.get().find(a => a.id === packId)
    if (!pack || !pack.mapUids || pack.mapUids.length === 0) return

    const jukedSet = this.getJukeboxIdentifiers()
    const packUids = pack.mapUids.map(u => String(u).trim()).filter(u => u.length > 0)

    const isAllJuked = packUids.length > 0 && packUids.every(uid => jukedSet.has(uid))

    // Set flag to suppress individual JukeboxChanged re-renders during batch operation
    this.isProcessingPack = true

    try {
      if (isAllJuked) {
        tm.sendMessage(`$0F0[Map Packs] $FFFRemoving all map pack maps from the jukebox, please wait for this to finish...`)
        for (const uid of packUids) {
          await this.sleep(75)
          await tm.jukebox.remove(uid, { login, nickname })
        } 
      } else {
        const mapPacksRepo = new MapPacksRepository()
        await mapPacksRepo.addMapPackToJukebox(login, packId) 
        const command = tm.commands.list.find(c => c.aliases.includes('initializePlaylist') || c.aliases.includes('ip'))
        if (command) {
          const player = tm.players.get(login)
          if (player) {
            const commandContext = {
              ...player,
              text: '/ip',
              date: new Date(),
              aliasUsed: 'ip'
            } 
            void command.callback(commandContext, [])
          }
        }
      }
    } finally {
      this.isProcessingPack = false
      if (isAllJuked){
        tm.sendMessage(`$0F0[Map Packs] $FFFSuccessfully finished removing all map pack maps from the jukebox.`)
      }
      this.reRender()
    }
  }

  private getActionId(packId: number): number {
    let mapActionId: number = this.packActionIds.indexOf(packId)
    if (mapActionId === -1) {
      this.packActionIds.push(packId)
      mapActionId = this.packActionIds.length - 1
    }
    return mapActionId + this.openId + this.packAddId
  }

  private getHeader(packIndex: number, actionId: number, isAllJuked: boolean, w: number, h: number): string {
    const height: number = h - this.margin
    const width = (w - this.margin * 3) - config.iconWidth

    const overlay: string | undefined = isAllJuked
      ? `<quad posn="${-this.margin} ${this.margin} 8" sizen="${w} ${h}" action="${actionId}" image="${config.blankImage}" imagefocus="${icons.removeMap}"/>`
      : undefined

    return `${overlay ?? `<quad posn="${-this.margin} ${this.margin} 8" sizen="${w} ${h}" action="${actionId}" image="${config.blankImage}" imagefocus="${config.plusImage}"/>`}
            <quad posn="0 0 3" sizen="${config.iconWidth} ${height / 3 - this.margin}" bgcolor="${config.iconBackground}"/>
            <quad posn="${this.margin} ${-this.margin} 4" sizen="${config.iconWidth - this.margin * 2} ${(height / 3) - this.margin * 3}" image="${config.icons[0]}"/>
            <frame posn="${config.iconWidth + this.margin} 0 1">
              <quad posn="0 0 3" sizen="${width} ${height / 3 - this.margin}" bgcolor="${config.iconBackground}"/>
              ${leftAlignedText(`${config.texts.pack}${packIndex + 1}`, width, height / 3 - this.margin, { textScale: config.textScale })}
            </frame>`
  }
}

tm.addListener('Startup', (): void => {
  new MappackList()
})