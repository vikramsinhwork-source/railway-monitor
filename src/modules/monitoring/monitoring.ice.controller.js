const DEFAULT_ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

export async function getIceConfig(req, res) {
  return res.json({
    success: true,
    data: {
      ice_servers: [
        ...DEFAULT_ICE_SERVERS,
        {
          urls: ['turn:turn.railwaymonitor.in:3478'],
          username: process.env.TURN_USERNAME || 'turnuser',
          credential: process.env.TURN_PASSWORD || 'turnpassword',
        },
      ],
    },
  });
}
