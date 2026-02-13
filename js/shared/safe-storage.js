function isStorageLike(storage) {
    return Boolean(storage)
        && typeof storage.getItem === 'function'
        && typeof storage.setItem === 'function';
}

function resolveStorage(storage) {
    if (isStorageLike(storage)) {
        return storage;
    }

    if (typeof localStorage !== 'undefined' && isStorageLike(localStorage)) {
        return localStorage;
    }

    return null;
}

export function safeGetJson(key, fallbackValue, storage = null) {
    const targetStorage = resolveStorage(storage);
    if (!targetStorage) {
        return fallbackValue;
    }

    try {
        const rawValue = targetStorage.getItem(key);
        if (!rawValue) {
            return fallbackValue;
        }

        return JSON.parse(rawValue);
    } catch {
        return fallbackValue;
    }
}

export function safeSetJson(key, value, storage = null) {
    const targetStorage = resolveStorage(storage);
    if (!targetStorage) {
        return false;
    }

    try {
        targetStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

export function safeRemoveItem(key, storage = null) {
    const targetStorage = resolveStorage(storage);
    if (!targetStorage || typeof targetStorage.removeItem !== 'function') {
        return false;
    }

    try {
        targetStorage.removeItem(key);
        return true;
    } catch {
        return false;
    }
}
