export const SystemLogSchema = {
  name: 'SystemLog',
  primaryKey: 'id',
  properties: {
    id: 'string',
    level: 'string', // 'INFO', 'WARN', 'ERROR'
    message: 'string',
    details: 'string?', // JSON stringified details
    timestamp: 'date',
  },
};
