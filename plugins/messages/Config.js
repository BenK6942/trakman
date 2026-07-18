const p = tm.utils.palette

export default {
  // Special message on every win multiple of this
  specialWin: 50,
  startup: {
    message: `${p.highlight}$L[${tm.config.controller.repo}]Trakman v#{version}$L${p.servermsg} startup sequence successful.`,
    public: true,
  },
  changelog: {
    message: `${p.error}You can see the recent changes with the ${p.highlight}/changes ${p.error}command.`,
    public: false
  },
  noPb: {
    message: `${p.error}You don't have a personal best on this map.`,
    public: false
  },
  pb: {
    message: `${p.record}Personal best${p.highlight}: #{time}${p.record}, the ${p.rank}#{rank} ${p.record}record.`,
    public: false
  },
  noRank: {
    message: `${p.error}You don't have a rank on the server yet.`,
    public: false
  },
  rank: {
    message: `${p.record}You are currently ranked ${p.rank}#{rank} ${p.record}out of ${p.highlight}#{total}${p.record} people total.`,
    public: false
  },
  welcome: {
    message: `${p.error}Welcome to ${p.highlight}#{name}${p.error}. This server is running ${p.highlight}$L[${tm.config.controller.repo}]Trakman v#{version}$L${p.error}.`,
    public: false
  },
  join: {
    message: `${p.servermsg}#{title}${p.highlight}: #{nickname}${p.servermsg} Country${p.highlight}: #{country} ${p.servermsg}Visits${p.highlight}: #{visits}${p.servermsg}.`,
    public: true
  },
  win: {
    message: `${p.record}You have won your ${p.rank}#{wins}${p.record} race.`,
    public: false
  },
  winPublic: {
    message: `${p.record}Congratulations to ${p.highlight}#{nickname} ${p.record}for winning their ${p.rank}#{wins} ${p.record}race.`,
    public: false
  },
  leave: {
    message: `${p.highlight}#{nickname}${p.servermsg} has quit after ${p.highlight}#{time}${p.servermsg}.`,
    public: false
  },
  record: {
    message: `${p.highlight}#{nickname}${p.record} has #{status} the ${p.rank}#{position}${p.record} local record. #{type}${p.highlight}: #{time}#{difference}`,
    public: false
  },
  lapRecord: {
    message: `${p.highlight}#{nickname}${p.message} has #{status} the ${p.rank}#{position}${p.message} lap record. Time${p.highlight}: #{time}#{difference}`,
    public: false
  },
  recordDifference: {
    message: ` $n${p.record}(${p.rank}#{position} ${p.highlight}#{time}${p.record})`,
  },
  dediDifference: {
    message: ` $n${p.dedirecord}(${p.rank}#{position} ${p.highlight}-#{time}${p.dedirecord})`,
  },
  dediRecord: {
    message: `${p.highlight}#{nickname}${p.dedirecord} has #{status} the ${p.rank}#{position}${p.dedirecord} dedimania record. Time${p.highlight}: #{time}#{difference}`,
    public: false
  },
  ultiDifference: {
    message: ` $n${p.dedirecord}(${p.rank}#{position} ${p.highlight}+#{score}${p.dedirecord})`,
  },
  ultiRecord: {
    message: `${p.highlight}#{nickname}${p.dedirecord} has #{status} the ${p.rank}#{position}${p.dedirecord} ultimania record. Score${p.highlight}: #{score}#{difference}`,
    public: false
  },
  nextJuke: {
    message: `${p.vote}The next map will be ${p.highlight}#{map}${p.vote}, as requested by ${p.highlight}#{nickname}${p.vote}.`,
    public: true
  },
  jukeSkipped: {
    message: `${p.vote}Map ${p.highlight}#{map} ${p.vote}will be dropped from the queue, as ${p.highlight}#{nickname} ${p.vote}has left the server.`,
    public: true
  },
}