export const CONFIG = Object.freeze({
  APP_STORAGE_KEY: 'tripsplit_v1_state',
  SYNC_PREFIX: 'TRIPSYNC1:',
  CURRENCY: {
    SYMBOL: '₹',
    CODE: 'INR',
    SUBUNITS: 100 // 1 Rupee = 100 Paise
  },
  CATEGORIES: [
    { id: 'Food', label: 'Food & Drinks', icon: '🍲', color: '#f97316' },
    { id: 'Stay', label: 'Stay & Hotel', icon: '🏨', color: '#8b5cf6' },
    { id: 'Travel', label: 'Travel & Fuel', icon: '🚕', color: '#06b6d4' },
    { id: 'Activities', label: 'Activities', icon: '🎟️', color: '#10b981' },
    { id: 'Shopping', label: 'Shopping', icon: '🛍️', color: '#ec4899' },
    { id: 'Other', label: 'Other', icon: '📦', color: '#64748b' }
  ]
});
