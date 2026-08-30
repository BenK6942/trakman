import { icons, componentIds as ids } from '../../ui/UI.js'
const p = tm.utils.palette

export default {  
  title: "Map Packs",
  icon: icons.mapList,
  textScale: 1,
  padding: 0.1,
  colour: p.green,
  rows: 5,
  columns: 4,
  grid: {
    background: 'FFFA',
    margin: 0.15
  },
  texts: {
    pack: 'Map Pack #',
    maps: 'Maps in pack: '
  },
  icons: [
    icons.ongoingMap, // Header icon
    icons.tag, // Pack name icon
    icons.chartLocal // Map count icon
  ],
  iconWidth: 2,
  iconBackground: "222C",
  contentBackground: "555C",
  plusImage: icons.addMap,
  blankImage: icons.blank,
  commands: {
    list: {
      aliases: ['packs', 'mappacks'],
      help: `Display list of map packs.`,
      privilege: 0
    }
  },
  
}