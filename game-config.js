const GAME_CONFIG_KEYS = ['updateCheckIntervalMs', 'wikimediaImageWidth'];

export function validateGameConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Game config must be a JSON object');
  }

  const unknownKeys = Object.keys(config).filter((key) => !GAME_CONFIG_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown game config option(s): ${unknownKeys.join(', ')}`);
  }

  for (const key of GAME_CONFIG_KEYS) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) {
      throw new Error(`Game config "${key}" must be a positive integer`);
    }
  }

  return config;
}
