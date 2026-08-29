import cfg from '../../ui/config/RaceUi.js'
import icons from '../../ui/config/Icons.js'

export default {
  // Number of rows to show in your widget grid
  entries: 6,
  entryHeight: 2.15,
  width: cfg.width,
  margin: cfg.margin,
  icon: icons.chartLocal,
  // Custom metadata for the static header overlay
  title: "Livesplits",

  // Flexbox column proportions required by your List.js layout grid
  // [Index Column, Map Name Column, Finish Time Column]
  columnProportions: [1, 5, 2]
}
