(function () {
    'use strict';

    /**
     * ANDRPROD v3.1.0 — Единый центр управления онлайн-источниками для Lampa
     * Аудит и восстановление:
     * - Безопасная инициализация с проверкой window.Lampa, jQuery и регистрацией Lampa.Manifest.plugins.
     * - Флаг загрузки выставляется ТОЛЬКО после успешной регистрации основных компонентов.
     * - Независимый запуск модулей + журнал ошибок Diagnostics (без скрывающих пустых catch).
     * - Строгий белый список онлайн-кинотеатров (без тем, системных расширений и TorrServer).
     * - Реальные адаптеры источников (Lampac/BWA /lite/events, Lampa.Api.sources, делегирование кнопок, ANDRPROD_API).
     * - Единый поиск (Ручной с выбором плагинов / Автоматический / Лучший выбор) + TitleResolver без ошибки EN.
     * - Фильтры по реальным данным: 4K/2160p, 1080p, 720p, SD, HDR, Dolby Vision, С переводом, С субтитрами.
     * - Экран диагностики ANDRPROD.
     * - Чистый ES5 для Smart TV (Android TV, Tizen, webOS, Desktop WebView).
     */

    if (window.andrprod_plugin_ready) return;

    var PLUGIN_ID = 'andrprod';
    var PLUGIN_VERSION = '3.1.0';
    var HUB_COMPONENT = 'andrprod_hub';
    var SEARCH_COMPONENT = 'andrprod_search';

    // =========================================================================
    // 1. МОДУЛЬ ДИАГНОСТИКИ И ЛОГИРОВАНИЯ (Diagnostics)
    // =========================================================================
    var Diagnostics = {
        loaded: false,
        manifestRegistered: false,
        componentsRegistered: {
            hub: false,
            search: false
        },
        cardIntegrationActive: false,
        lastCardEventAt: 0,
        lastSearchDurationMs: 0,
        unsupportedPlugins: [], // Неизвестные/не-онлайн расширения, не попавшие в каталог
        errors: [],             // [{ time, module, message }]

        logError: function (moduleName, err) {
            var msg = err && err.message ? err.message : String(err || 'Неизвестная ошибка');
            Diagnostics.errors.unshift({
                time: formatTime(Date.now()),
                module: moduleName || 'Core',
                message: msg
            });
            if (Diagnostics.errors.length > 50) Diagnostics.errors.length = 50;
            try {
                if (window.console && typeof console.error === 'function') {
                    console.error('[ANDRPROD:' + moduleName + ']', msg);
                }
            } catch (e) {}
        },

        getReport: function () {
            var plugins = SourceRegistry.getPlugins();
            var sources = SourceRegistry.getAllSources();
            var activeAdapters = [];
            var i;
            for (i = 0; i < plugins.length; i++) {
                activeAdapters.push(plugins[i].name + ' (' + plugins[i].adapterType + ')');
            }
            return {
                version: PLUGIN_VERSION,
                loaded: Diagnostics.loaded,
                manifestRegistered: Diagnostics.manifestRegistered,
                hubRegistered: Diagnostics.componentsRegistered.hub,
                searchRegistered: Diagnostics.componentsRegistered.search,
                cardIntegrationActive: Diagnostics.cardIntegrationActive,
                lastCardEventAt: Diagnostics.lastCardEventAt,
                onlinePluginsCount: plugins.length,
                onlinePlugins: plugins,
                activeAdapters: activeAdapters,
                sourcesCount: sources.length,
                unsupportedPlugins: Diagnostics.unsupportedPlugins,
                lastSearchDurationMs: Diagnostics.lastSearchDurationMs,
                errors: Diagnostics.errors
            };
        }
    };

    // =========================================================================
    // 2. ПРОЗРАЧНЫЙ ЛОГОТИП ANDRPROD И ИКОНКИ ПЛАГИНОВ (BrandIcons)
    // =========================================================================
    var BrandIcons = {
        getLogoSvg: function (className, uid) {
            var gradId = 'andrprod_grad_' + (uid || 'main');
            return (
                '<svg class="andrprod-logo-svg ' + (className || '') + '" viewBox="0 0 340 58" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-label="ANDRPROD" role="img">' +
                    '<defs>' +
                        '<linearGradient id="' + gradId + '" x1="0%" y1="0%" x2="100%" y2="0%">' +
                            '<stop offset="0%" stop-color="#7DD3FC"/>' +
                            '<stop offset="45%" stop-color="#38BDF8"/>' +
                            '<stop offset="100%" stop-color="#2563EB"/>' +
                        '</linearGradient>' +
                    '</defs>' +
                    '<text x="170" y="44" text-anchor="middle" fill="url(#' + gradId + ')" ' +
                        'text-rendering="geometricPrecision" ' +
                        'font-family="\'Segoe UI\', \'Roboto\', \'Helvetica Neue\', Arial, sans-serif" ' +
                        'font-size="44" font-weight="900" letter-spacing="4">ANDRPROD</text>' +
                '</svg>'
            );
        },

        getMiniIconSvg: function () {
            return (
                '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">' +
                    '<path d="M4 18L10.5 5H13.5L20 18H16.8L15.4 15H8.6L7.2 18H4ZM9.7 12.4H14.3L12 7.5L9.7 12.4Z" fill="#38BDF8"/>' +
                '</svg>'
            );
        },

        getPluginIconHtml: function (plugin) {
            if (plugin && plugin.nativeIcon) {
                var raw = String(plugin.nativeIcon);
                if (raw.indexOf('<svg') !== -1) {
                    return '<div class="andrprod-plugin-icon is-native">' + raw + '</div>';
                }
                if (raw.indexOf('http') === 0 || raw.indexOf('data:image') === 0) {
                    return (
                        '<div class="andrprod-plugin-icon is-native">' +
                            '<img src="' + escapeHtml(raw) + '" alt="' + escapeHtml(plugin.name || '') + '"/>' +
                        '</div>'
                    );
                }
            }

            var name = (plugin && plugin.name) ? String(plugin.name) : 'PL';
            var abbr = BrandIcons._makeAbbreviation(name);
            var accent = BrandIcons._pickAccentColor(plugin ? plugin.id : name);

            return (
                '<div class="andrprod-plugin-icon" style="border-color:' + accent + '44;background:' + accent + '1A;">' +
                    '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">' +
                        '<text x="24" y="30" text-anchor="middle" fill="' + accent + '" ' +
                            'font-family="\'Segoe UI\', Roboto, Arial, sans-serif" ' +
                            'font-size="' + (abbr.length > 2 ? '15' : '18') + '" font-weight="800" letter-spacing="0.8">' +
                            escapeHtml(abbr) +
                        '</text>' +
                    '</svg>' +
                '</div>'
            );
        },

        _makeAbbreviation: function (name) {
            var clean = safeTrim(String(name || '').replace(/[^a-zA-Zа-яА-ЯёЁ0-9\s]/g, ' ').replace(/\s+/g, ' '));
            if (!clean) return 'PL';
            var words = clean.split(' ');
            if (words.length >= 2) return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
            if (clean.length <= 3) return clean.toUpperCase();
            return clean.slice(0, 2).toUpperCase();
        },

        _pickAccentColor: function (seed) {
            var palette = ['#38BDF8', '#60A5FA', '#34D399', '#A78BFA', '#22D3EE', '#818CF8', '#2DD4BF'];
            var hash = 0;
            var s = String(seed || '');
            var i;
            for (i = 0; i < s.length; i++) {
                hash = ((hash << 5) - hash) + s.charCodeAt(i);
                hash |= 0;
            }
            return palette[Math.abs(hash) % palette.length];
        }
    };

    // =========================================================================
    // 3. ХРАНИЛИЩЕ НАСТРОЕК (StorageManager / Config)
    // =========================================================================
    var STORAGE_KEYS = {
        mode: 'andrprod_mode',                        // 'manual' | 'auto' | 'best'
        bestChoice: 'andrprod_best_choice',           // true | false
        autoSearch: 'andrprod_auto_search',           // true | false
        hideBroken: 'andrprod_hide_broken',           // true | false
        timeout: 'andrprod_timeout_ms',               // 3000 | 6000 | 9000 | 12000
        disabled: 'andrprod_disabled_sources',        // { key: true }
        disabledPlugins: 'andrprod_disabled_plugins', // { pluginId: true }
        favorites: 'andrprod_favorite_sources',       // { key: true }
        favoritePlugins: 'andrprod_favorite_plugins', // { pluginId: true }
        priorities: 'andrprod_source_priorities',     // [key1, key2, ...]
        manualSelection: 'andrprod_manual_plugins',   // { pluginId: true }
        filters: 'andrprod_filters_v3'                // FilterState
    };

    function getDefaultFilters() {
        return {
            quality: 'all',          // 'all' | '4k' | '2160p' | '1080p' | '720p' | 'sd' | 'unknown'
            contentType: 'all',      // 'all' | 'movie' | 'series' | 'cartoon' | 'anime'
            pluginId: 'all',
            onlyWorking: false,
            onlyFavorites: false,
            only4k: false,
            onlyFullHd: false,
            onlyHDR: false,
            onlyDV: false,
            onlyTranslated: false,
            onlySubtitles: false,
            hideUnavailable: false,
            sortBy: 'priority',
            searchQuery: ''
        };
    }

    var StorageManager = {
        get: function (key, defVal) {
            try {
                if (!window.Lampa || !Lampa.Storage || typeof Lampa.Storage.get !== 'function') return defVal;
                var val = Lampa.Storage.get(key, defVal);
                return typeof val === 'undefined' || val === null ? defVal : val;
            } catch (e) {
                Diagnostics.logError('StorageManager.get', e);
                return defVal;
            }
        },
        set: function (key, val) {
            try {
                if (!window.Lampa || !Lampa.Storage || typeof Lampa.Storage.set !== 'function') return;
                Lampa.Storage.set(key, val);
            } catch (e) {
                Diagnostics.logError('StorageManager.set', e);
            }
        },
        getMode: function () {
            var m = StorageManager.get(STORAGE_KEYS.mode, 'manual');
            if (m === 'auto' || m === 'best' || m === 'manual') return m;
            return 'manual';
        },
        setMode: function (mode) {
            var valid = (mode === 'auto' || mode === 'best') ? mode : 'manual';
            StorageManager.set(STORAGE_KEYS.mode, valid);
            if (valid === 'best') StorageManager.setBestChoice(true);
        },
        isBestChoice: function () {
            if (StorageManager.getMode() === 'best') return true;
            var v = StorageManager.get(STORAGE_KEYS.bestChoice, false);
            return v === true || v === 'true';
        },
        setBestChoice: function (flag) {
            StorageManager.set(STORAGE_KEYS.bestChoice, !!flag);
        },
        isAutoSearch: function () {
            var v = StorageManager.get(STORAGE_KEYS.autoSearch, true);
            return v === true || v === 'true';
        },
        setAutoSearch: function (flag) {
            StorageManager.set(STORAGE_KEYS.autoSearch, !!flag);
        },
        isHideBroken: function () {
            var v = StorageManager.get(STORAGE_KEYS.hideBroken, false);
            return v === true || v === 'true';
        },
        setHideBroken: function (flag) {
            StorageManager.set(STORAGE_KEYS.hideBroken, !!flag);
        },
        getTimeout: function () {
            var t = parseInt(StorageManager.get(STORAGE_KEYS.timeout, 6000), 10);
            if (isNaN(t) || t < 2000 || t > 20000) return 6000;
            return t;
        },
        setTimeoutMs: function (ms) {
            StorageManager.set(STORAGE_KEYS.timeout, parseInt(ms, 10) || 6000);
        },
        getDisabledMap: function () {
            var m = StorageManager.get(STORAGE_KEYS.disabled, {});
            return m && typeof m === 'object' ? m : {};
        },
        isEnabled: function (sourceKey) {
            return !StorageManager.getDisabledMap()[sourceKey];
        },
        setEnabled: function (sourceKey, enabled) {
            var m = StorageManager.getDisabledMap();
            if (enabled) delete m[sourceKey];
            else m[sourceKey] = true;
            StorageManager.set(STORAGE_KEYS.disabled, m);
        },
        getFavoritesMap: function () {
            var m = StorageManager.get(STORAGE_KEYS.favorites, {});
            return m && typeof m === 'object' ? m : {};
        },
        isFavorite: function (sourceKey) {
            return !!StorageManager.getFavoritesMap()[sourceKey];
        },
        toggleFavorite: function (sourceKey) {
            var m = StorageManager.getFavoritesMap();
            if (m[sourceKey]) delete m[sourceKey];
            else m[sourceKey] = true;
            StorageManager.set(STORAGE_KEYS.favorites, m);
            return !!m[sourceKey];
        },
        getDisabledPluginsMap: function () {
            var m = StorageManager.get(STORAGE_KEYS.disabledPlugins, {});
            return m && typeof m === 'object' ? m : {};
        },
        isPluginEnabled: function (pluginId) {
            return !StorageManager.getDisabledPluginsMap()[pluginId];
        },
        setPluginEnabled: function (pluginId, enabled) {
            var m = StorageManager.getDisabledPluginsMap();
            if (enabled) delete m[pluginId];
            else m[pluginId] = true;
            StorageManager.set(STORAGE_KEYS.disabledPlugins, m);
        },
        getFavoritePluginsMap: function () {
            var m = StorageManager.get(STORAGE_KEYS.favoritePlugins, {});
            return m && typeof m === 'object' ? m : {};
        },
        isPluginFavorite: function (pluginId) {
            return !!StorageManager.getFavoritePluginsMap()[pluginId];
        },
        togglePluginFavorite: function (pluginId) {
            var m = StorageManager.getFavoritePluginsMap();
            if (m[pluginId]) delete m[pluginId];
            else m[pluginId] = true;
            StorageManager.set(STORAGE_KEYS.favoritePlugins, m);
            return !!m[pluginId];
        },
        getManualSelectionMap: function () {
            var m = StorageManager.get(STORAGE_KEYS.manualSelection, {});
            return m && typeof m === 'object' ? m : {};
        },
        isSelectedForManualSearch: function (pluginId) {
            var m = StorageManager.getManualSelectionMap();
            // По умолчанию выбраны все включённые онлайн-плагины
            return m[pluginId] !== false;
        },
        toggleManualSelection: function (pluginId) {
            var m = StorageManager.getManualSelectionMap();
            var next = (m[pluginId] === false);
            m[pluginId] = next;
            StorageManager.set(STORAGE_KEYS.manualSelection, m);
            return next;
        },
        getPriorities: function () {
            var arr = StorageManager.get(STORAGE_KEYS.priorities, []);
            return Object.prototype.toString.call(arr) === '[object Array]' ? arr : [];
        },
        setPriorities: function (arr) {
            StorageManager.set(STORAGE_KEYS.priorities, arr || []);
        },
        movePriority: function (sourceKey, direction) {
            var list = SourceRegistry.getAllSources();
            var ids = [];
            var i;
            for (i = 0; i < list.length; i++) ids.push(list[i].key);
            var idx = ids.indexOf(sourceKey);
            if (idx === -1) return false;
            var target = idx + direction;
            if (target < 0 || target >= ids.length) return false;
            var tmp = ids[idx];
            ids[idx] = ids[target];
            ids[target] = tmp;
            StorageManager.setPriorities(ids);
            return true;
        },
        getFilters: function () {
            var def = getDefaultFilters();
            var saved = StorageManager.get(STORAGE_KEYS.filters, null);
            if (!saved || typeof saved !== 'object') return def;
            var k;
            for (k in def) {
                if (def.hasOwnProperty(k) && typeof saved[k] !== 'undefined') def[k] = saved[k];
            }
            return def;
        },
        setFilters: function (patch) {
            var cur = StorageManager.getFilters();
            var k;
            if (patch && typeof patch === 'object') {
                for (k in patch) if (patch.hasOwnProperty(k)) cur[k] = patch[k];
            }
            StorageManager.set(STORAGE_KEYS.filters, cur);
            return cur;
        },
        resetFilters: function () {
            var def = getDefaultFilters();
            StorageManager.set(STORAGE_KEYS.filters, def);
            return def;
        }
    };

    var Config = StorageManager;

    // =========================================================================
    // 4. РАЗРЕШЕНИЕ НАЗВАНИЙ ФИЛЬМОВ И СЕРИАЛОВ (TitleResolver)
    // =========================================================================
    var TitleResolver = {
        extractMediaMeta: function (card, explicitMethod) {
            card = card || {};
            var isSeries = TitleResolver.detectIsSeries(card, explicitMethod);

            var localizedTitle = '';
            var originalTitle = '';
            var rawDate = '';

            if (isSeries) {
                localizedTitle = safeTrim(String(card.name || card.title || ''));
                originalTitle = safeTrim(String(card.original_name || card.original_title || ''));
                rawDate = String(card.first_air_date || card.release_date || card.year || '');
            } else {
                localizedTitle = safeTrim(String(card.title || card.name || ''));
                originalTitle = safeTrim(String(card.original_title || card.original_name || ''));
                rawDate = String(card.release_date || card.first_air_date || card.year || '');
            }

            var yearMatch = rawDate.match(/\d{4}/);
            var year = yearMatch ? yearMatch[0] : '';
            var altTitles = TitleResolver._extractAlternativeTitles(card);
            var englishTitle = TitleResolver._extractEnglishTitle(card, originalTitle, altTitles);

            var meta = {
                id: card.id || '',
                tmdbId: card.id || '',
                imdbId: card.imdb_id || '',
                kinopoiskId: card.kinopoisk_id || card.kp_id || '',
                mediaType: isSeries ? 'series' : 'movie',
                isSeries: isSeries,
                title: localizedTitle || originalTitle || englishTitle || '',
                localizedTitle: localizedTitle,
                originalTitle: originalTitle,
                englishTitle: englishTitle,
                alternativeTitles: altTitles,
                year: year,
                numberOfSeasons: card.number_of_seasons || (card.seasons && card.seasons.length ? card.seasons.length : 0),
                numberOfEpisodes: card.number_of_episodes || 0,
                originalLanguage: String(card.original_language || '').toLowerCase(),
                rawCard: card
            };

            meta.queryVariants = TitleResolver.buildQueryVariants(meta);
            return meta;
        },

        detectIsSeries: function (card, explicitMethod) {
            if (explicitMethod === 'tv' || explicitMethod === 'series') return true;
            if (explicitMethod === 'movie') return false;
            if (card.first_air_date || card.number_of_seasons || card.original_name) return true;
            if (card.media_type === 'tv') return true;
            if (card.name && !card.title) return true;
            return false;
        },

        _extractAlternativeTitles: function (card) {
            var out = [];
            var seen = {};
            function add(val) {
                var clean = safeTrim(String(val || ''));
                if (!clean) return;
                var low = clean.toLowerCase();
                if (!seen[low]) {
                    seen[low] = true;
                    out.push(clean);
                }
            }
            var alt = card.alternative_titles;
            var list = null;
            if (alt) {
                if (Object.prototype.toString.call(alt) === '[object Array]') list = alt;
                else if (Object.prototype.toString.call(alt.titles) === '[object Array]') list = alt.titles;
                else if (Object.prototype.toString.call(alt.results) === '[object Array]') list = alt.results;
            }
            if (list) {
                var i;
                for (i = 0; i < list.length; i++) {
                    if (typeof list[i] === 'string') add(list[i]);
                    else if (list[i] && (list[i].title || list[i].name)) add(list[i].title || list[i].name);
                }
            }
            return out;
        },

        _extractEnglishTitle: function (card, originalTitle, altTitles) {
            if (card.english_title) return safeTrim(String(card.english_title));
            if (String(card.original_language || '').toLowerCase() === 'en' && originalTitle) {
                return originalTitle;
            }
            var alt = card.alternative_titles;
            var list = alt ? (alt.titles || alt.results || null) : null;
            if (Object.prototype.toString.call(list) === '[object Array]') {
                var i;
                for (i = 0; i < list.length; i++) {
                    var item = list[i];
                    if (item && (item.iso_3166_1 === 'US' || item.iso_3166_1 === 'GB' || item.iso_639_1 === 'en') && (item.title || item.name)) {
                        return safeTrim(String(item.title || item.name));
                    }
                }
            }
            // Если оригинальное название написано на латинице и язык не указан явно как неанглийский
            if (originalTitle && /^[A-Za-z0-9\s:'\-.,!?&+()]+$/.test(originalTitle)) {
                var lang = String(card.original_language || '').toLowerCase();
                if (!lang || lang === 'en') return originalTitle;
            }
            return '';
        },

        buildQueryVariants: function (meta) {
            var variants = [];
            var seen = {};
            function pushVariant(q, label) {
                var clean = safeTrim(String(q || '').replace(/\s+/g, ' '));
                if (!clean) return;
                var key = clean.toLowerCase();
                if (seen[key]) return;
                seen[key] = true;
                variants.push({ query: clean, label: label });
            }
            function stripYear(s) {
                return safeTrim(String(s || '').replace(/\s*\(\d{4}\)\s*$/, '').replace(/\s+\d{4}$/, ''));
            }

            pushVariant(meta.localizedTitle, 'Локализованное');
            pushVariant(meta.originalTitle, 'Оригинальное');
            pushVariant(meta.englishTitle, 'Английское');

            var i;
            for (i = 0; i < Math.min(meta.alternativeTitles.length, 3); i++) {
                pushVariant(meta.alternativeTitles[i], 'Альтернативное');
            }
            if (meta.year) {
                if (meta.localizedTitle) pushVariant(stripYear(meta.localizedTitle) + ' ' + meta.year, 'Локализованное + год');
                if (meta.originalTitle) pushVariant(stripYear(meta.originalTitle) + ' ' + meta.year, 'Оригинальное + год');
                if (meta.englishTitle) pushVariant(stripYear(meta.englishTitle) + ' ' + meta.year, 'Английское + год');
            }
            if (meta.localizedTitle) pushVariant(stripYear(meta.localizedTitle), 'Без года');
            if (meta.originalTitle) pushVariant(stripYear(meta.originalTitle), 'Оригинал без года');

            return variants;
        }
    };

    // =========================================================================
    // 5. СТРОГИЙ БЕЛЫЙ СПИСОК ПОДТВЕРЖДЁННЫХ ОНЛАЙН-КИНОТЕАТРОВ
    // =========================================================================
    // Исключены темы, интерфейс, субтитры, рейтинги, реклама, каталоги и TorrServer.
    var NON_ONLINE_BLACKLIST = [
        'theme', 'skin', 'style', 'css', 'ui', 'interface', 'design', 'logo', 'icon',
        'rating', 'kp_rating', 'imdb', 'shots', 'tracks', 'sub', 'subtitle', 'trailer',
        'torrserver', 'torrent', 'jacred', 'parser', 'tmdb_proxy', 'proxy', 'cub',
        'adblock', 'ads', 'menu', 'background', 'backdrop', 'cardify', 'easymode',
        'collection', 'recommend', 'myshows', 'shikimori', 'calendar', 'history', 'sync'
    ];

    var ONLINE_PLUGIN_WHITELIST = [
        {
            id: 'lampac',
            name: 'Lampac',
            adapterType: 'lampac_protocol',
            patterns: ['lampac', '/online.js', 'online_prestige', 'lampa.mx', 'smotret24', 'jin.energy', 'newonline.js'],
            buttonHints: ['online_prestige', 'lampac', 'онлайн', 'online']
        },
        {
            id: 'bwa',
            name: 'BWA',
            adapterType: 'lampac_protocol',
            patterns: ['bwa.to', '/bwa', 'rc.bwa', 'bwa.js'],
            buttonHints: ['bwa']
        },
        {
            id: 'alpaca',
            name: 'Alpaca',
            adapterType: 'lampac_or_native',
            patterns: ['alpaca'],
            buttonHints: ['alpaca']
        },
        {
            id: 'online_mod',
            name: 'Online Mod',
            adapterType: 'online_mod',
            patterns: ['online_mod', 'nb557'],
            buttonHints: ['online_mod', 'онлайн мод', 'online mod']
        },
        {
            id: 'lumio',
            name: 'Lumio',
            adapterType: 'lampac_or_native',
            patterns: ['lumio'],
            buttonHints: ['lumio']
        },
        {
            id: 'showy',
            name: 'Showy',
            adapterType: 'lampac_or_native',
            patterns: ['showy'],
            buttonHints: ['showy']
        },
        {
            id: 'hdrezka',
            name: 'HDRezka',
            adapterType: 'native_plugin',
            patterns: ['hdrezka', 'rezka.js', '/rezka'],
            buttonHints: ['hdrezka', 'rezka', 'резка']
        },
        {
            id: 'kinopub',
            name: 'KinoPub',
            adapterType: 'native_plugin',
            patterns: ['kinopub', 'kpub'],
            buttonHints: ['kinopub', 'кинопаб']
        },
        {
            id: 'filmix',
            name: 'Filmix',
            adapterType: 'native_plugin',
            patterns: ['filmix'],
            buttonHints: ['filmix', 'филмикс']
        },
        {
            id: 'kodik',
            name: 'Kodik',
            adapterType: 'native_plugin',
            patterns: ['kodik'],
            buttonHints: ['kodik', 'кодик']
        },
        {
            id: 'alloha',
            name: 'Alloha',
            adapterType: 'lampac_or_native',
            patterns: ['alloha'],
            buttonHints: ['alloha']
        },
        {
            id: 'collaps',
            name: 'Collaps',
            adapterType: 'lampac_or_native',
            patterns: ['collaps'],
            buttonHints: ['collaps']
        },
        {
            id: 'videocdn',
            name: 'VideoCDN',
            adapterType: 'lampac_or_native',
            patterns: ['videocdn', 'vcdn'],
            buttonHints: ['videocdn', 'vcdn']
        },
        {
            id: 'ashdi',
            name: 'Ashdi',
            adapterType: 'native_plugin',
            patterns: ['ashdi'],
            buttonHints: ['ashdi']
        },
        {
            id: 'eneyida',
            name: 'Eneyida',
            adapterType: 'native_plugin',
            patterns: ['eneyida'],
            buttonHints: ['eneyida']
        },
        {
            id: 'uakino',
            name: 'UAKino',
            adapterType: 'native_plugin',
            patterns: ['uakino'],
            buttonHints: ['uakino']
        }
    ];

    var IGNORED_BUTTON_CLASSES = [
        'andrprod-card-btn',
        'button--book',
        'button--reaction',
        'button--options',
        'button--subscribe',
        'button--trailer',
        'view--trailer',
        'view--torrent'
    ];

    function isBlacklistedExtension(lowerUrl, lowerName) {
        var i, word;
        for (i = 0; i < NON_ONLINE_BLACKLIST.length; i++) {
            word = NON_ONLINE_BLACKLIST[i];
            if (lowerUrl.indexOf(word) !== -1 || lowerName.indexOf(word) !== -1) {
                return true;
            }
        }
        return false;
    }

    // =========================================================================
    // 6. АДАПТЕРЫ ОБНАРУЖЕНИЯ РЕАЛЬНЫХ ИСТОЧНИКОВ (PluginAdapterEngine)
    // =========================================================================
    var PluginAdapterEngine = {
        normalizeSourceRecord: function (plugin, raw) {
            var srcId = makeSafeId(raw.id || raw.balanser || raw.name || 'entry');
            var key = plugin.id + '::' + srcId;

            var q = raw.qualities || {};
            var has4k = typeof q.has4k === 'boolean' ? q.has4k : null;
            var has2160p = typeof q.has2160p === 'boolean' ? q.has2160p : (has4k === true ? true : null);
            var has1080p = typeof q.has1080p === 'boolean' ? q.has1080p : null;
            var has720p = typeof q.has720p === 'boolean' ? q.has720p : null;
            var hasSD = typeof q.hasSD === 'boolean' ? q.hasSD : null;
            var hasHDR = typeof q.hasHDR === 'boolean' ? q.hasHDR : null;
            var hasDV = typeof q.hasDV === 'boolean' ? q.hasDV : null;

            var ct = raw.contentTypes || {};
            return {
                key: key,
                id: srcId,
                pluginId: plugin.id,
                pluginName: plugin.name,
                name: raw.name || plugin.name,
                balanser: raw.balanser || '',
                url: raw.url || '',
                isNativeEntryOnly: !!raw.isNativeEntryOnly,
                integrationMode: raw.integrationMode || 'plugin_delegate',
                note: raw.note || '',
                hasTranslation: typeof raw.hasTranslation === 'boolean' ? raw.hasTranslation : null,
                hasSubtitles: typeof raw.hasSubtitles === 'boolean' ? raw.hasSubtitles : null,
                qualities: {
                    has4k: has4k,
                    has2160p: has2160p,
                    has1080p: has1080p,
                    has720p: has720p,
                    hasSD: hasSD,
                    hasHDR: hasHDR,
                    hasDV: hasDV
                },
                contentTypes: {
                    movies: typeof ct.movies === 'boolean' ? ct.movies : null,
                    series: typeof ct.series === 'boolean' ? ct.series : null,
                    cartoons: typeof ct.cartoons === 'boolean' ? ct.cartoons : null,
                    anime: typeof ct.anime === 'boolean' ? ct.anime : null
                },
                adapter: raw.adapter || null
            };
        },

        extractOrigin: function (url) {
            if (!url || typeof url !== 'string') return '';
            var m = url.match(/^(https?:\/\/[^\/\?#]+)/i);
            return m ? m[1] : '';
        },

        parseQualityMetadata: function (rawQuality, extraFlags) {
            var out = {};
            if (rawQuality && typeof rawQuality === 'object') {
                out = cloneObj(rawQuality);
            } else if (rawQuality) {
                var s = String(rawQuality).toLowerCase();
                if (s.indexOf('2160') !== -1 || s.indexOf('4k') !== -1 || s.indexOf('uhd') !== -1) {
                    out.has4k = true; out.has2160p = true; out.has1080p = true; out.has720p = true;
                } else if (s.indexOf('1080') !== -1 || s.indexOf('fhd') !== -1 || s.indexOf('full hd') !== -1) {
                    out.has4k = false; out.has1080p = true; out.has720p = true;
                } else if (s.indexOf('720') !== -1 || s.indexOf('hd') !== -1) {
                    out.has4k = false; out.has1080p = false; out.has720p = true;
                } else if (s.indexOf('480') !== -1 || s.indexOf('360') !== -1 || s.indexOf('sd') !== -1) {
                    out.has4k = false; out.has1080p = false; out.has720p = false; out.hasSD = true;
                }
                if (s.indexOf('hdr') !== -1) out.hasHDR = true;
                if (s.indexOf('dolby vision') !== -1 || s.indexOf('dovi') !== -1 || /\bdv\b/.test(s)) out.hasDV = true;
            }
            if (extraFlags && typeof extraFlags === 'object') {
                if (typeof extraFlags.hdr === 'boolean') out.hasHDR = extraFlags.hdr;
                if (typeof extraFlags.dv === 'boolean' || typeof extraFlags.dolby_vision === 'boolean') {
                    out.hasDV = !!(extraFlags.dv || extraFlags.dolby_vision);
                }
            }
            return out;
        },

        parseLampacEventsPayload: function (plugin, payload) {
            var items = [];
            if (!payload) return items;

            var rawList = null;
            if (Object.prototype.toString.call(payload) === '[object Array]') {
                rawList = payload;
            } else if (typeof payload === 'string') {
                try {
                    var parsed = JSON.parse(payload);
                    if (Object.prototype.toString.call(parsed) === '[object Array]') rawList = parsed;
                    else if (parsed && Object.prototype.toString.call(parsed.channels) === '[object Array]') rawList = parsed.channels;
                    else if (parsed && Object.prototype.toString.call(parsed.results) === '[object Array]') rawList = parsed.results;
                } catch (eJson) {
                    return items;
                }
            } else if (typeof payload === 'object') {
                if (Object.prototype.toString.call(payload.channels) === '[object Array]') rawList = payload.channels;
                else if (Object.prototype.toString.call(payload.results) === '[object Array]') rawList = payload.results;
            }

            if (!rawList || !rawList.length) return items;

            var i, entry, title, balanser, url;
            for (i = 0; i < rawList.length; i++) {
                entry = rawList[i];
                if (!entry || typeof entry !== 'object' || entry.show === false) continue;

                title = entry.name || entry.title || entry.balanser || '';
                balanser = entry.balanser || entry.id || '';
                url = entry.url || '';
                if (!title) continue;

                items.push(PluginAdapterEngine.normalizeSourceRecord(plugin, {
                    id: balanser || title,
                    name: title,
                    balanser: balanser,
                    url: url,
                    isNativeEntryOnly: false,
                    integrationMode: 'lampac_events',
                    note: 'Реальный источник сервера (/lite/events)',
                    qualities: PluginAdapterEngine.parseQualityMetadata(entry.qualities || entry.max_quality || entry.quality, entry),
                    contentTypes: entry.contentTypes || {},
                    hasTranslation: typeof entry.hasTranslation === 'boolean' ? entry.hasTranslation : null,
                    hasSubtitles: typeof entry.hasSubtitles === 'boolean' ? entry.hasSubtitles : null
                }));
            }
            return items;
        },

        discoverForPlugin: function (plugin, callback) {
            var self = this;

            if (plugin.customAdapter) {
                var ad = plugin.customAdapter;
                if (typeof ad.getSources === 'function') {
                    var doneAd = false;
                    var timerAd = setTimeout(function () {
                        if (doneAd) return;
                        doneAd = true;
                        Diagnostics.logError('Adapter:' + plugin.name, 'Тайм-аут получения источников');
                        callback([]);
                    }, StorageManager.getTimeout());

                    try {
                        ad.getSources(function (list) {
                            if (doneAd) return;
                            doneAd = true;
                            clearTimeout(timerAd);
                            var out = [];
                            if (Object.prototype.toString.call(list) === '[object Array]') {
                                var i;
                                for (i = 0; i < list.length; i++) {
                                    var item = cloneObj(list[i]);
                                    item.adapter = ad;
                                    item.integrationMode = 'direct_adapter';
                                    out.push(self.normalizeSourceRecord(plugin, item));
                                }
                            }
                            callback(out);
                        });
                    } catch (eAd) {
                        if (!doneAd) {
                            doneAd = true;
                            clearTimeout(timerAd);
                            Diagnostics.logError('Adapter:' + plugin.name, eAd);
                            callback([]);
                        }
                    }
                    return;
                }

                callback([
                    self.normalizeSourceRecord(plugin, {
                        id: ad.id,
                        name: ad.name || plugin.name,
                        url: ad.url || plugin.url || '',
                        isNativeEntryOnly: false,
                        integrationMode: 'direct_adapter',
                        note: ad.description || 'Подключён прямой API-адаптер',
                        qualities: ad.qualities || {},
                        contentTypes: ad.contentTypes || {},
                        adapter: ad
                    })
                ]);
                return;
            }

            var origin = self.extractOrigin(plugin.url);
            if (origin && (plugin.adapterType === 'lampac_protocol' || plugin.adapterType === 'lampac_or_native')) {
                self._probeLampacEvents(plugin, origin, function (serverSources) {
                    if (serverSources && serverSources.length) callback(serverSources);
                    else callback(self._buildHonestNativeFallback(plugin));
                });
                return;
            }

            if (plugin.adapterType === 'online_mod') {
                callback(self._buildOnlineModSources(plugin));
                return;
            }

            callback(self._buildHonestNativeFallback(plugin));
        },

        _probeLampacEvents: function (plugin, origin, callback) {
            var self = this;
            var net = null;
            try {
                net = new Lampa.Reguest();
                net.timeout(StorageManager.getTimeout());
            } catch (e) {
                Diagnostics.logError('LampacProbe:' + plugin.name, e);
                callback([]);
                return;
            }

            var endpoint = origin + '/lite/events?life=true';
            var done = false;
            var guard = setTimeout(function () {
                if (done) return;
                done = true;
                try { net.clear(); } catch (eC) {}
                callback([]);
            }, StorageManager.getTimeout() + 250);

            net.silent(
                endpoint,
                function (resp) {
                    if (done) return;
                    done = true;
                    clearTimeout(guard);
                    callback(self.parseLampacEventsPayload(plugin, resp));
                },
                function () {
                    if (done) return;
                    done = true;
                    clearTimeout(guard);
                    callback([]);
                },
                false,
                { dataType: 'text' }
            );
        },

        _buildOnlineModSources: function (plugin) {
            var activeBalanser = '';
            try { activeBalanser = String(Lampa.Storage.get('online_mod_balanser', '') || ''); } catch (e) {}
            return [
                PluginAdapterEngine.normalizeSourceRecord(plugin, {
                    id: activeBalanser || 'native_entry',
                    name: activeBalanser ? ('Online Mod — ' + activeBalanser) : 'Online Mod (оригинальный интерфейс)',
                    balanser: activeBalanser,
                    url: plugin.url || '',
                    isNativeEntryOnly: true,
                    integrationMode: 'plugin_delegate',
                    note: 'Внутренний список закрыт внутри Online Mod — запуск через штатную кнопку плагина.',
                    qualities: {},
                    contentTypes: {}
                })
            ];
        },

        _buildHonestNativeFallback: function (plugin) {
            return [
                PluginAdapterEngine.normalizeSourceRecord(plugin, {
                    id: 'native_entry',
                    name: plugin.name + ' (оригинальный интерфейс)',
                    url: plugin.url || '',
                    isNativeEntryOnly: true,
                    integrationMode: 'plugin_delegate',
                    note: 'У плагина нет публичного API внутренних источников — запуск через его штатную кнопку в карточке.',
                    qualities: {},
                    contentTypes: {}
                })
            ];
        }
    };

    // =========================================================================
    // 7. РЕЕСТР ТОЛЬКО ОНЛАЙН-ПЛАГИНОВ И ИХ ИСТОЧНИКОВ (SourceRegistry)
    // =========================================================================
    var SourceRegistry = {
        plugins: {},
        sources: {},
        customAdapters: {},
        healthCache: {},

        resetAndScan: function () {
            var self = this;
            var discoveredPlugins = {};
            var unsupportedList = [];

            // 1. Пользовательские API-адаптеры
            var adId;
            for (adId in self.customAdapters) {
                if (!self.customAdapters.hasOwnProperty(adId)) continue;
                var ad = self.customAdapters[adId];
                discoveredPlugins[ad.id] = {
                    id: ad.id,
                    name: ad.name || ad.id,
                    url: ad.url || '',
                    nativeIcon: ad.icon || '',
                    adapterType: 'custom_adapter',
                    buttonHints: ad.buttonHints || [ad.id],
                    detectedVia: 'API-адаптер',
                    customAdapter: ad
                };
            }

            // 2. Установленные плагины Lampa (только белый список онлайн-кинотеатров!)
            var rawPlugins = [];
            try {
                var stored = Lampa.Storage.get('plugins', []);
                if (Object.prototype.toString.call(stored) === '[object Array]') rawPlugins = rawPlugins.concat(stored);
            } catch (e1) {
                Diagnostics.logError('SourceRegistry.storage', e1);
            }