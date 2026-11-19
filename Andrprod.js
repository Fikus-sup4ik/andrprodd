(function () {
    'use strict';

    /**
     * ANDRPROD DD v4.0.1 — Единый агрегатор онлайн-источников для Lampa
     * Совместимость: Android, Android TV, Tizen, webOS, Desktop WebView (строгий ES5)
     *
     * Архитектура:
     * 1.  Diagnostics           — статус загрузки/инициализации, журнал ошибок, проверка всех источников.
     * 2.  BrandIcons            — прозрачный логотип ANDRPROD DD (без рамки и подложки) и иконки источников.
     * 3.  StorageManager        — хранение всех настроек в Lampa.Storage (источники, языки, min/max качество, поиск).
     * 4.  TitleResolver         — извлечение метаданных фильма/сериала (TMDB/IMDB/KP ID, названия, постер, год).
     * 5.  AdapterFactory        — модульная система адаптеров (getSourceInfo, isAvailable, searchMovie, searchSeries, getStreams, play).
     * 6.  SourceRegistry        — белый список онлайн-кинотеатров + внешние адаптеры через window.ANDRPROD_API.
     * 7.  FilterEngine          — фильтрация по языкам (UA/RU/EN/другие), min/max качеству, озвучке, HDR/DV, сортировка.
     * 8.  BestChoiceEngine      — взвешенный выбор лучшего подтверждённого варианта.
     * 9.  UnifiedSearchEngine   — параллельный поиск с отменой (net.clear), 1 ретраем при ошибке, дедупликацией и кешем SearchCache.
     * 10. CardIntegration       — кнопка ANDRPROD DD в карточке фильма/сериала + безопасный запуск живых кнопок (фикс повторного нажатия).
     * 11. AndrprodSearchComponent — главный экран агрегатора (постер, метаданные, статусы, 50+ результатов, прокрутка, пульт ТВ).
     * 12. AndrprodHubComponent  — «Выбрать источники» и «Диагностика» с кнопкой «Проверить все источники».
     * 13. SettingsIntegration   — полный раздел Lampa → Настройки → ANDRPROD DD (Lampa.SettingsApi).
     */

    if (window.andrprod_dd_ready) return;

    var PLUGIN_ID = 'andrprod_dd';
    var PLUGIN_NAME = 'ANDRPROD DD';
    var PLUGIN_VERSION = '4.0.1';
    var HUB_COMPONENT = 'andrprod_hub';
    var SEARCH_COMPONENT = 'andrprod_search';

    // =========================================================================
    // 1. ДИАГНОСТИКА И ЛОГИРОВАНИЕ (Diagnostics)
    // =========================================================================
    var Diagnostics = {
        loaded: false,
        initialized: false,
        manifestRegistered: false,
        componentsRegistered: { hub: false, search: false },
        cardIntegrationActive: false,
        lastCardEventAt: 0,
        lastSearchAt: 0,
        lastSearchDurationMs: 0,
        lastResultCount: 0,
        unsupportedPlugins: [],
        lastCheckResults: {}, // sourceId -> { name, ok, status, latency, message, checkedAt }
        errors: [],

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
                    console.error('[ANDRPROD DD:' + moduleName + ']', msg);
                }
            } catch (e) {}
        },

        getReport: function () {
            var adapters = SourceRegistry.getAdapters();
            var activeCount = 0;
            var i;
            for (i = 0; i < adapters.length; i++) {
                if (StorageManager.isSourceEnabled(adapters[i].getSourceInfo().id)) activeCount++;
            }
            return {
                version: PLUGIN_VERSION,
                loaded: Diagnostics.loaded,
                initialized: Diagnostics.initialized,
                manifestRegistered: Diagnostics.manifestRegistered,
                hubRegistered: Diagnostics.componentsRegistered.hub,
                searchRegistered: Diagnostics.componentsRegistered.search,
                cardIntegrationActive: Diagnostics.cardIntegrationActive,
                discoveredCount: adapters.length,
                activeCount: activeCount,
                unsupportedCount: Diagnostics.unsupportedPlugins.length,
                unsupportedPlugins: Diagnostics.unsupportedPlugins,
                lastSearchAt: Diagnostics.lastSearchAt,
                lastSearchDurationMs: Diagnostics.lastSearchDurationMs,
                lastResultCount: Diagnostics.lastResultCount,
                lastError: Diagnostics.errors.length ? Diagnostics.errors[0] : null,
                errors: Diagnostics.errors,
                lastCheckResults: Diagnostics.lastCheckResults
            };
        }
    };

    // =========================================================================
    // 2. ПРОЗРАЧНЫЙ ЛОГОТИП ANDRPROD DD И ИКОНКИ (BrandIcons)
    // =========================================================================
    var BrandIcons = {
        getLogoSvg: function (className, uid) {
            var gradId = 'andrprod_dd_grad_' + (uid || 'main');
            return (
                '<svg class="andrprod-logo-svg ' + (className || '') + '" viewBox="0 0 420 58" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-label="ANDRPROD DD" role="img">' +
                    '<defs>' +
                        '<linearGradient id="' + gradId + '" x1="0%" y1="0%" x2="100%" y2="0%">' +
                            '<stop offset="0%" stop-color="#7DD3FC"/>' +
                            '<stop offset="48%" stop-color="#38BDF8"/>' +
                            '<stop offset="100%" stop-color="#2563EB"/>' +
                        '</linearGradient>' +
                    '</defs>' +
                    '<text x="210" y="44" text-anchor="middle" fill="url(#' + gradId + ')" ' +
                        'text-rendering="geometricPrecision" ' +
                        'font-family="\'Segoe UI\', \'Roboto\', \'Helvetica Neue\', Arial, sans-serif" ' +
                        'font-size="42" font-weight="900" letter-spacing="3.5">ANDRPROD DD</text>' +
                '</svg>'
            );
        },

        getMiniIconSvg: function () {
            return (
                '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">' +
                    '<path d="M4 18L10.5 5H13.5L20 18H16.8L15.4 15H8.6L7.2 18H4ZM9.7 12.4H14.3L12 7.5L9.7 12.4Z" fill="#38BDF8"/>' +
                '</svg>'
            );
        }
    };

    // =========================================================================
    // 3. ХРАНИЛИЩЕ НАСТРОЕК В LAMPA (StorageManager)
    // =========================================================================
    var STORAGE_KEYS = {
        searchMode: 'andrprod_dd_search_mode',         // 'auto' | 'manual' | 'best'
        timeoutMs: 'andrprod_dd_timeout_ms',           // 3000 | 6000 | 9000 | 12000
        retryOnError: 'andrprod_dd_retry_on_error',    // true | false
        showProgress: 'andrprod_dd_show_progress',     // true | false
        langUk: 'andrprod_dd_lang_uk',                 // true | false
        langRu: 'andrprod_dd_lang_ru',                 // true | false
        langEn: 'andrprod_dd_lang_en',                 // true | false
        langOther: 'andrprod_dd_lang_other',           // true | false
        minQuality: 'andrprod_dd_min_quality',         // 'any' | '480p' | '720p' | '1080p' | '2160p' | '4k'
        maxQuality: 'andrprod_dd_max_quality',         // 'any' | '4k' | '2160p' | '1080p' | '720p' | '480p'
        prefVoice: 'andrprod_dd_pref_voice',           // 'any' | 'dub' | 'multi' | 'orig'
        hideUnavailable: 'andrprod_dd_hide_unavail',   // true | false
        hideUnmatched: 'andrprod_dd_hide_unmatched',   // true | false
        sortBy: 'andrprod_dd_sort_by',                 // 'priority' | 'quality' | 'speed' | 'name'
        disabledSources: 'andrprod_dd_disabled_src',   // { sourceId: true }
        priorities: 'andrprod_dd_priorities'           // [sourceId1, sourceId2, ...]
    };

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
        getBool: function (key, defVal) {
            var v = StorageManager.get(key, defVal);
            if (typeof v === 'boolean') return v;
            if (v === 'true' || v === 1 || v === '1') return true;
            if (v === 'false' || v === 0 || v === '0') return false;
            return !!defVal;
        },
        getSearchMode: function () {
            var m = StorageManager.get(STORAGE_KEYS.searchMode, 'auto');
            return (m === 'manual' || m === 'best' || m === 'auto') ? m : 'auto';
        },
        setSearchMode: function (m) {
            StorageManager.set(STORAGE_KEYS.searchMode, (m === 'manual' || m === 'best') ? m : 'auto');
        },
        getTimeoutMs: function () {
            var t = parseInt(StorageManager.get(STORAGE_KEYS.timeoutMs, 6000), 10);
            if (isNaN(t) || t < 2000 || t > 20000) return 6000;
            return t;
        },
        isRetryOnError: function () { return StorageManager.getBool(STORAGE_KEYS.retryOnError, true); },
        isShowProgress: function () { return StorageManager.getBool(STORAGE_KEYS.showProgress, true); },
        getAllowedLanguages: function () {
            return {
                uk: StorageManager.getBool(STORAGE_KEYS.langUk, true),
                ru: StorageManager.getBool(STORAGE_KEYS.langRu, true),
                en: StorageManager.getBool(STORAGE_KEYS.langEn, true),
                other: StorageManager.getBool(STORAGE_KEYS.langOther, true)
            };
        },
        getMinQuality: function () { return String(StorageManager.get(STORAGE_KEYS.minQuality, 'any') || 'any'); },
        getMaxQuality: function () { return String(StorageManager.get(STORAGE_KEYS.maxQuality, 'any') || 'any'); },
        getPrefVoice: function () { return String(StorageManager.get(STORAGE_KEYS.prefVoice, 'any') || 'any'); },
        isHideUnavailable: function () { return StorageManager.getBool(STORAGE_KEYS.hideUnavailable, false); },
        isHideUnmatched: function () { return StorageManager.getBool(STORAGE_KEYS.hideUnmatched, true); },
        getSortBy: function () { return String(StorageManager.get(STORAGE_KEYS.sortBy, 'priority') || 'priority'); },
        getDisabledMap: function () {
            var m = StorageManager.get(STORAGE_KEYS.disabledSources, {});
            return m && typeof m === 'object' ? m : {};
        },
        isSourceEnabled: function (id) { return !StorageManager.getDisabledMap()[id]; },
        setSourceEnabled: function (id, enabled) {
            var m = StorageManager.getDisabledMap();
            if (enabled) delete m[id];
            else m[id] = true;
            StorageManager.set(STORAGE_KEYS.disabledSources, m);
        },
        getPriorities: function () {
            var arr = StorageManager.get(STORAGE_KEYS.priorities, []);
            return Object.prototype.toString.call(arr) === '[object Array]' ? arr : [];
        },
        setPriorities: function (arr) { StorageManager.set(STORAGE_KEYS.priorities, arr || []); },
        movePriority: function (sourceId, direction) {
            var adapters = SourceRegistry.getAdapters();
            var ids = [];
            var i;
            for (i = 0; i < adapters.length; i++) ids.push(adapters[i].getSourceInfo().id);
            var idx = ids.indexOf(sourceId);
            if (idx === -1) return false;
            var target = idx + direction;
            if (target < 0 || target >= ids.length) return false;
            var tmp = ids[idx];
            ids[idx] = ids[target];
            ids[target] = tmp;
            StorageManager.setPriorities(ids);
            return true;
        }
    };

    // =========================================================================
    // 4. МЕТАДАННЫЕ ФИЛЬМА / СЕРИАЛА (TitleResolver)
    // =========================================================================
    var TitleResolver = {
        extractMediaMeta: function (card, explicitMethod) {
            card = card || {};
            var isSeries = TitleResolver.detectIsSeries(card, explicitMethod);
            var localizedTitle = isSeries ? safeTrim(card.name || card.title) : safeTrim(card.title || card.name);
            var originalTitle = isSeries ? safeTrim(card.original_name || card.original_title) : safeTrim(card.original_title || card.original_name);
            var rawDate = String(isSeries ? (card.first_air_date || card.release_date || card.year || '') : (card.release_date || card.first_air_date || card.year || ''));
            var ym = rawDate.match(/\d{4}/);
            var year = ym ? ym[0] : '';

            var poster = '';
            try {
                if (card.poster_path && window.Lampa && Lampa.TMDB && typeof Lampa.TMDB.image === 'function') {
                    poster = Lampa.TMDB.image('t/p/w300' + card.poster_path);
                } else if (card.img) {
                    poster = card.img;
                }
            } catch (eImg) {
                poster = card.img || '';
            }

            var meta = {
                id: card.id || '',
                tmdbId: card.id || '',
                imdbId: card.imdb_id || '',
                kinopoiskId: card.kinopoisk_id || card.kp_id || '',
                mediaType: isSeries ? 'series' : 'movie',
                isSeries: isSeries,
                title: localizedTitle || originalTitle || 'Без названия',
                localizedTitle: localizedTitle,
                originalTitle: originalTitle,
                year: year,
                poster: poster,
                rating: card.vote_average ? Number(card.vote_average).toFixed(1) : '',
                numberOfSeasons: card.number_of_seasons || (card.seasons && card.seasons.length ? card.seasons.length : 0),
                originalLanguage: String(card.original_language || '').toLowerCase(),
                rawCard: card
            };
            meta.queryVariants = TitleResolver.buildQueryVariants(meta);
            return meta;
        },

        detectIsSeries: function (card, explicitMethod) {
            if (explicitMethod === 'tv' || explicitMethod === 'series') return true;
            if (explicitMethod === 'movie') return false;
            if (card.first_air_date || card.number_of_seasons || card.original_name || card.media_type === 'tv') return true;
            if (card.name && !card.title) return true;
            return false;
        },

        buildQueryVariants: function (meta) {
            var out = [];
            var seen = {};
            function add(q) {
                var clean = safeTrim(String(q || '').replace(/\s+/g, ' '));
                if (!clean) return;
                var low = clean.toLowerCase();
                if (!seen[low]) { seen[low] = true; out.push(clean); }
            }
            add(meta.localizedTitle);
            add(meta.originalTitle);
            if (meta.year && meta.localizedTitle) add(meta.localizedTitle + ' ' + meta.year);
            if (meta.year && meta.originalTitle) add(meta.originalTitle + ' ' + meta.year);
            return out;
        }
    };

    // =========================================================================
    // 5. БЕЛЫЙ СПИСОК ОНЛАЙН-КИНОТЕАТРОВ И ЧЁРНЫЙ СПИСОК
    // =========================================================================
    var NON_ONLINE_BLACKLIST = [
        'theme', 'skin', 'style', 'css', 'ui', 'interface', 'design', 'logo', 'icon',
        'rating', 'kp_rating', 'imdb', 'shots', 'tracks', 'subtitle', 'trailer',
        'torrserver', 'torrent', 'jacred', 'parser', 'tmdb_proxy', 'proxy', 'cub',
        'adblock', 'advert', 'menu', 'background', 'backdrop', 'cardify', 'easymode',
        'collection', 'recommend', 'myshows', 'shikimori', 'calendar', 'history', 'sync'
    ];

    var ONLINE_PLUGIN_WHITELIST = [
        { id: 'lampac', name: 'Lampac', kind: 'lampac_protocol', patterns: ['lampac', '/online.js', 'online_prestige', 'lampa.mx', 'smotret24', 'jin.energy', 'newonline.js'], buttonHints: ['online_prestige', 'lampac', 'онлайн', 'online'] },
        { id: 'bwa', name: 'BWA', kind: 'lampac_protocol', patterns: ['bwa.to', '/bwa', 'rc.bwa', 'bwa.js'], buttonHints: ['bwa'] },
        { id: 'uaflix', name: 'UAFlix', kind: 'lampac_or_native', patterns: ['uaflix'], buttonHints: ['uaflix'] },
        { id: 'uafilm', name: 'UAFilm', kind: 'lampac_or_native', patterns: ['uafilm'], buttonHints: ['uafilm'] },
        { id: 'line_prime', name: 'Line Prime', kind: 'lampac_or_native', patterns: ['lineprime', 'line_prime', 'line-prime'], buttonHints: ['line prime', 'lineprime'] },
        { id: 'online_mod', name: 'Online Mod', kind: 'online_mod', patterns: ['online_mod', 'nb557'], buttonHints: ['online_mod', 'онлайн мод', 'online mod', 'lampac--button', 'view--online', 'онлайн'] },
        { id: 'alpaca', name: 'Alpaca', kind: 'lampac_or_native', patterns: ['alpaca'], buttonHints: ['alpaca'] },
        { id: 'lumio', name: 'Lumio', kind: 'lampac_or_native', patterns: ['lumio'], buttonHints: ['lumio'] },
        { id: 'showy', name: 'Showy', kind: 'lampac_or_native', patterns: ['showy'], buttonHints: ['showy'] },
        { id: 'hdrezka', name: 'HDRezka', kind: 'native_only', patterns: ['hdrezka', 'rezka.js', '/rezka'], buttonHints: ['hdrezka', 'rezka', 'резка'] },
        { id: 'kinopub', name: 'KinoPub', kind: 'native_only', patterns: ['kinopub', 'kpub'], buttonHints: ['kinopub', 'кинопаб'] },
        { id: 'filmix', name: 'Filmix', kind: 'native_only', patterns: ['filmix'], buttonHints: ['filmix', 'филмикс'] },
        { id: 'kodik', name: 'Kodik', kind: 'native_only', patterns: ['kodik'], buttonHints: ['kodik', 'кодик'] },
        { id: 'ashdi', name: 'Ashdi', kind: 'native_only', patterns: ['ashdi'], buttonHints: ['ashdi'] },
        { id: 'eneyida', name: 'Eneyida', kind: 'native_only', patterns: ['eneyida'], buttonHints: ['eneyida'] },
        { id: 'uakino', name: 'UAKino', kind: 'native_only', patterns: ['uakino'], buttonHints: ['uakino'] }
    ];

    function isBlacklisted(lowerUrl, lowerName) {
        var i;
        for (i = 0; i < NON_ONLINE_BLACKLIST.length; i++) {
            if (lowerUrl.indexOf(NON_ONLINE_BLACKLIST[i]) !== -1 || lowerName.indexOf(NON_ONLINE_BLACKLIST[i]) !== -1) return true;
        }
        return false;
    }

    // =========================================================================
    // 6. МОДУЛЬНАЯ СИСТЕМА АДАПТЕРОВ (AdapterFactory)
    // =========================================================================
    // Единый контракт адаптера:
    //   getSourceInfo(), isAvailable(cb), searchMovie(meta, opts, cb),
    //   searchSeries(meta, opts, cb), getStreams(item, meta, cb), play(result, meta)
    var AdapterFactory = {
        extractOrigin: function (url) {
            if (!url || typeof url !== 'string') return '';
            var m = url.match(/^(https?:\/\/[^\/\?#]+)/i);
            return m ? m[1] : '';
        },

        /**
         * Создаёт адаптер для Lampac / BWA и Lampac-совместимых серверов (/lite/events).
         */
        createLampacAdapter: function (pluginMeta) {
            var origin = AdapterFactory.extractOrigin(pluginMeta.url);

            function runSearch(mediaMeta, opts, callback) {
                if (!origin) {
                    callback({ status: 'unsupported', error: 'Отсутствует HTTP-адрес сервера', results: [] });
                    return;
                }
                probeEndpoint(origin + '/lite/events?life=true', opts, function (err, resp) {
                    if (err || !resp) {
                        var isStrictLampac = pluginMeta.kind === 'lampac_protocol';
                        callback({
                            status: isStrictLampac ? 'error' : 'unsupported',
                            error: isStrictLampac ? ('Сервер не ответил (/lite/events): ' + (err || 'пустой ответ')) : 'Плагин не поддерживает программный API /lite/events',
                            results: []
                        });
                        return;
                    }
                    var balancers = parseLampacBalancers(resp);
                    if (!balancers.length) {
                        callback({ status: 'empty', error: '', results: [] });
                        return;
                    }

                    var allResults = [];
                    var doneCount = 0;
                    var hadErr = false;
                    var i;
                    for (i = 0; i < balancers.length; i++) {
                        (function (bal) {
                            queryLampacBalancer(pluginMeta, bal, mediaMeta, opts, 0, 0, function (bErr, list) {
                                if (bErr) hadErr = true;
                                if (list && list.length) allResults = allResults.concat(list);
                                doneCount++;
                                if (doneCount >= balancers.length) {
                                    if (allResults.length) callback({ status: 'found', error: '', results: allResults });
                                    else if (hadErr) callback({ status: 'error', error: 'Ошибки при опросе балансиров', results: [] });
                                    else callback({ status: 'empty', error: '', results: [] });
                                }
                            });
                        })(balancers[i]);
                    }
                });
            }

            return {
                getSourceInfo: function () {
                    return {
                        id: pluginMeta.id,
                        name: pluginMeta.name,
                        url: pluginMeta.url || '',
                        kind: pluginMeta.kind,
                        supported: true,
                        integrationLevel: pluginMeta.kind === 'lampac_protocol' ? 'full' : 'probe',
                        reason: pluginMeta.kind === 'lampac_protocol'
                            ? 'Поддерживается программный поиск (/lite/events) и прямой запуск'
                            : 'Проверка /lite/events; при отсутствии API — делегирование штатной кнопки'
                    };
                },
                isAvailable: function (cb) {
                    if (!origin) { cb(false, 'Нет URL сервера', 0); return; }
                    var t0 = Date.now();
                    probeEndpoint(origin + '/lite/events?life=true', { noRetry: true }, function (err, resp) {
                        var lat = Date.now() - t0;
                        if (err || !resp) {
                            cb(false, err || 'Сервер недоступен', lat);
                            return;
                        }
                        var bals = parseLampacBalancers(resp);
                        cb(bals.length > 0, bals.length > 0 ? ('Доступно балансиров: ' + bals.length) : 'Сервер ответил без балансиров', lat);
                    });
                },
                searchMovie: function (mediaMeta, opts, cb) { runSearch(mediaMeta, opts, cb); },
                searchSeries: function (mediaMeta, opts, cb) { runSearch(mediaMeta, opts, cb); },
                getStreams: function (item, mediaMeta, cb) {
                    cb(null, item && item.streamUrl ? [{ url: item.streamUrl, quality: item.qualityMap || null }] : []);
                },
                play: function (result, mediaMeta) {
                    return launchPlaybackSafe(result, mediaMeta);
                }
            };
        },

        /**
         * Создаёт честный адаптер для закрытых плагинов (Online Mod, HDRezka, KinoPub, и др.),
         * не имеющих публичного программного API поиска: не выдумывает результаты,
         * а безопасно делегирует запуск живой кнопке плагина в карточке.
         */
        createNativeDelegationAdapter: function (pluginMeta) {
            return {
                getSourceInfo: function () {
                    return {
                        id: pluginMeta.id,
                        name: pluginMeta.name,
                        url: pluginMeta.url || '',
                        kind: pluginMeta.kind,
                        supported: false,
                        integrationLevel: 'partial',
                        reason: 'Закрытый плагин без публичного JS-API поиска; доступен запуск через оригинальную кнопку в карточке'
                    };
                },
                isAvailable: function (cb) {
                    if (!pluginMeta.url || pluginMeta.url.indexOf('http') !== 0) {
                        cb(true, 'Локальный плагин (кнопка карточки)', 0);
                        return;
                    }
                    var t0 = Date.now();
                    probeEndpoint(pluginMeta.url, { noRetry: true }, function (err) {
                        cb(!err, !err ? 'Скрипт плагина доступен (без API поиска)' : ('Недоступен: ' + err), Date.now() - t0);
                    });
                },
                searchMovie: function (mediaMeta, opts, cb) {
                    cb({ status: 'unsupported', error: 'Плагин не предоставляет API программного поиска', results: [] });
                },
                searchSeries: function (mediaMeta, opts, cb) {
                    cb({ status: 'unsupported', error: 'Плагин не предоставляет API программного поиска', results: [] });
                },
                getStreams: function (item, mediaMeta, cb) { cb('Программное получение потоков не поддерживается', []); },
                play: function (result, mediaMeta) {
                    return CardIntegration.launchPluginLiveButton(pluginMeta.id);
                }
            };
        },

        /**
         * Оборачивает внешний пользовательский адаптер (window.ANDRPROD_API.registerAdapter)
         * в стандартный контракт адаптера ANDRPROD DD.
         */
        wrapCustomAdapter: function (raw) {
            return {
                getSourceInfo: function () {
                    if (typeof raw.getSourceInfo === 'function') return raw.getSourceInfo();
                    return {
                        id: raw.id,
                        name: raw.name || raw.id,
                        url: raw.url || '',
                        kind: 'custom_adapter',
                        supported: true,
                        integrationLevel: 'full',
                        reason: raw.description || 'Пользовательский API-адаптер'
                    };
                },
                isAvailable: function (cb) {
                    if (typeof raw.isAvailable === 'function') { raw.isAvailable(cb); return; }
                    if (typeof raw.check === 'function') { raw.check(cb); return; }
                    cb(true, 'Пользовательский адаптер активен', 0);
                },
                searchMovie: function (mediaMeta, opts, cb) {
                    var fn = typeof raw.searchMovie === 'function' ? raw.searchMovie : raw.search;
                    if (typeof fn !== 'function') { cb({ status: 'unsupported', error: 'Метод поиска не реализован', results: [] }); return; }
                    invokeCustomSearch(raw, fn, mediaMeta, opts, cb);
                },
                searchSeries: function (mediaMeta, opts, cb) {
                    var fn = typeof raw.searchSeries === 'function' ? raw.searchSeries : raw.search;
                    if (typeof fn !== 'function') { cb({ status: 'unsupported', error: 'Метод поиска не реализован', results: [] }); return; }
                    invokeCustomSearch(raw, fn, mediaMeta, opts, cb);
                },
                getStreams: function (item, mediaMeta, cb) {
                    if (typeof raw.getStreams === 'function') { raw.getStreams(item, mediaMeta, cb); return; }
                    cb(null, item && item.streamUrl ? [{ url: item.streamUrl, quality: item.qualityMap || null }] : []);
                },
                play: function (result, mediaMeta) {
                    if (typeof raw.play === 'function') return raw.play(result, mediaMeta);
                    if (typeof raw.open === 'function') { raw.open(mediaMeta ? mediaMeta.rawCard : {}, function () {}, result); return true; }
                    return launchPlaybackSafe(result, mediaMeta);
                }
            };
        }
    };

    function invokeCustomSearch(raw, fn, mediaMeta, opts, cb) {
        var t0 = Date.now();
        var finished = false;
        var timer = setTimeout(function () {
            if (finished) return;
            finished = true;
            cb({ status: 'error', error: 'Таймаут адаптера', results: [] });
        }, StorageManager.getTimeoutMs());
        UnifiedSearchEngine._trackTimer(timer);

        try {
            fn(mediaMeta, mediaMeta.queryVariants, function (err, list) {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                if (err) {
                    Diagnostics.logError('Adapter:' + (raw.name || raw.id), err);
                    cb({ status: 'error', error: String(err), results: [] });
                    return;
                }
                var normalized = normalizeResultArray(raw.id, raw.name || raw.id, list, Date.now() - t0, mediaMeta);
                cb({ status: normalized.length ? 'found' : 'empty', error: '', results: normalized });
            });
        } catch (e) {
            if (!finished) {
                finished = true;
                clearTimeout(timer);
                Diagnostics.logError('Adapter:' + (raw.name || raw.id), e);
                cb({ status: 'error', error: e.message || String(e), results: [] });
            }
        }
    }

    function probeEndpoint(url, opts, callback) {
        opts = opts || {};
        var net = null;
        try {
            net = new Lampa.Reguest();
            net.timeout(StorageManager.getTimeoutMs());
            UnifiedSearchEngine._trackNet(net);
        } catch (e) {
            Diagnostics.logError('Network', e);
            callback('Lampa.Reguest недоступен', null);
            return;
        }

        var done = false;
        var guard = setTimeout(function () {
            if (done) return;
            done = true;
            try { net.clear(); } catch (eC) {}
            callback('Таймаут (' + Math.round(StorageManager.getTimeoutMs() / 1000) + ' с)', null);
        }, StorageManager.getTimeoutMs() + 250);
        UnifiedSearchEngine._trackTimer(guard);

        net.silent(
            url,
            function (resp) {
                if (done) return;
                done = true;
                clearTimeout(guard);
                callback(null, resp);
            },
            function () {
                if (done) return;
                done = true;
                clearTimeout(guard);
                callback('Ошибка сети', null);
            },
            false,
            { dataType: 'text' }
        );
    }

    function parseLampacBalancers(payload) {
        var out = [], raw = payload;
        if (typeof payload === 'string') {
            try { raw = JSON.parse(payload); } catch (e) { return out; }
        }
        if (!raw || typeof raw !== 'object') return out;

        function addList(list) {
            if (Object.prototype.toString.call(list) !== '[object Array]') return;
            var i, it, url;
            for (i = 0; i < list.length; i++) {
                it = list[i];
                if (!it || typeof it !== 'object' || it.show === false || it.disabled === true) continue;
                url = it.url || it.href || it.host || '';
                if (!url) continue;
                out.push({
                    id: makeSafeId(it.balanser || it.id || it.name || ('bal_' + i)),
                    name: it.name || it.title || it.balanser || ('Источник ' + (i + 1)),
                    url: url
                });
            }
        }

        addList(raw);
        addList(raw.channels);
        addList(raw.results);
        addList(raw.online);
        addList(raw.balancers);
        addList(raw.data);
        if (raw.life && typeof raw.life === 'object') {
            addList(raw.life.online);
            addList(raw.life.balancers);
            addList(raw.life.channels);
        }

        var unique = [], seen = {}, j, key;
        for (j = 0; j < out.length; j++) {
            key = String(out[j].url).replace(/\/+$/, '').toLowerCase();
            if (!seen[key]) { seen[key] = true; unique.push(out[j]); }
        }
        return unique;
    }

    function queryLampacBalancer(pluginMeta, bal, mediaMeta, opts, variantIdx, retryCount, callback) {
        var variants = mediaMeta.queryVariants || [];
        if (variantIdx >= Math.min(variants.length, 3)) {
            callback(null, []);
            return;
        }
        var q = variants[variantIdx];
        var sep = bal.url.indexOf('?') === -1 ? '?' : '&';
        var reqUrl = bal.url + sep +
            'rjson=true' +
            '&title=' + encodeURIComponent(q) +
            (mediaMeta.originalTitle ? '&original_title=' + encodeURIComponent(mediaMeta.originalTitle) : '') +
            (mediaMeta.year ? '&year=' + encodeURIComponent(mediaMeta.year) : '') +
            (mediaMeta.imdbId ? '&imdb_id=' + encodeURIComponent(mediaMeta.imdbId) : '') +
            (mediaMeta.kinopoiskId ? '&kinopoisk_id=' + encodeURIComponent(mediaMeta.kinopoiskId) : '') +
            (mediaMeta.id ? '&id=' + encodeURIComponent(mediaMeta.id) : '') +
            (mediaMeta.uid ? '&uid=' + encodeURIComponent(mediaMeta.uid) : '') +
            '&serial=' + (mediaMeta.isSeries ? '1' : '0') +
            (mediaMeta.season ? '&season=' + encodeURIComponent(mediaMeta.season) : '') +
            (mediaMeta.episode ? '&episode=' + encodeURIComponent(mediaMeta.episode) : '');

        var t0 = Date.now();
        probeEndpoint(reqUrl, opts, function (err, resp) {
            if (err) {
                // Ограниченный повторный запрос (максимум 1 раз при включённой настройке)
                if (retryCount < 1 && StorageManager.isRetryOnError() && !opts.noRetry) {
                    queryLampacBalancer(pluginMeta, bal, mediaMeta, opts, variantIdx, retryCount + 1, callback);
                    return;
                }
                callback(err, []);
                return;
            }
            var parsed = parseLampacStreams(pluginMeta, bal, mediaMeta, resp, Date.now() - t0);
            if (parsed.length) callback(null, parsed);
            else queryLampacBalancer(pluginMeta, bal, mediaMeta, opts, variantIdx + 1, 0, callback);
        });
    }

    /**
     * Парсит ВСЕ найденные варианты без искусственного ограничения (20, 30, 50+ вариантов).
     */
    function parseLampacStreams(pluginMeta, bal, mediaMeta, rawResp, latency) {
        var out = [];
        var data = rawResp;
        if (typeof rawResp === 'string') {
            try { data = JSON.parse(rawResp); }
            catch (e) {
                var re = /<[^>]*class=["'][^"']*videos__item[^"']*["'][^>]*>/gi;
                var match, attr, txt, obj, arr, k, itemHtml, u, qm, qt;
                while ((match = re.exec(rawResp))) {
                    attr = match[0].match(/data-json=["']([^"']+)["']/i);
                    if (!attr) continue;
                    txt = attr[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
                    try {
                        obj = JSON.parse(txt);
                        arr = Object.prototype.toString.call(obj) === '[object Array]' ? obj :
                            (obj.data || obj.results || [obj]);
                        if (Object.prototype.toString.call(arr) !== '[object Array]') continue;
                        for (k = 0; k < arr.length; k++) {
                            itemHtml = arr[k];
                            if (!itemHtml || typeof itemHtml !== 'object') continue;
                            u = itemHtml.url || itemHtml.file || itemHtml.stream || '';
                            qm = itemHtml.quality && typeof itemHtml.quality === 'object' ? itemHtml.quality : null;
                            qt = itemHtml.maxquality || itemHtml.quality_label ||
                                (typeof itemHtml.quality === 'string' ? itemHtml.quality : '');
                            if (qm) {
                                var qk;
                                for (qk in qm) if (qm.hasOwnProperty(qk) && qm[qk]) {
                                    out.push(buildNormalizedVariant(pluginMeta.id, pluginMeta.name, bal.name, itemHtml, qm[qk], qk, qm, latency, mediaMeta));
                                }
                            } else if (u) {
                                out.push(buildNormalizedVariant(pluginMeta.id, pluginMeta.name, bal.name, itemHtml, u, qt, null, latency, mediaMeta));
                            }
                        }
                    } catch (ignoreJson) {}
                }
                return out;
            }
        }
        var list = Object.prototype.toString.call(data) === '[object Array]'
            ? data
            : (data && Object.prototype.toString.call(data.data) === '[object Array]' ? data.data : null);
        if (!list || !list.length) return out;

        var i, item, streamUrl, qMap, qText;
        for (i = 0; i < list.length; i++) {
            item = list[i];
            if (!item || typeof item !== 'object') continue;
            streamUrl = item.url || item.file || item.stream || '';
            qMap = (item.quality && typeof item.quality === 'object') ? item.quality : null;
            qText = item.maxquality || item.quality_label || (typeof item.quality === 'string' ? item.quality : '');

            // Если сервер вернул несколько качеств для одного видео — создаём отдельный вариант на каждое качество!
            if (qMap) {
                var qKey;
                for (qKey in qMap) {
                    if (!qMap.hasOwnProperty(qKey) || !qMap[qKey]) continue;
                    out.push(buildNormalizedVariant(pluginMeta.id, pluginMeta.name, bal.name, item, qMap[qKey], qKey, qMap, latency, mediaMeta));
                }
            } else if (streamUrl) {
                out.push(buildNormalizedVariant(pluginMeta.id, pluginMeta.name, bal.name, item, streamUrl, qText, null, latency, mediaMeta));
            }
        }
        return out;
    }

    function normalizeResultArray(pluginId, pluginName, rawList, latency, mediaMeta) {
        var out = [];
        if (Object.prototype.toString.call(rawList) !== '[object Array]') return out;
        var i, r;
        for (i = 0; i < rawList.length; i++) {
            r = rawList[i];
            if (!r || typeof r !== 'object') continue;
            out.push(buildNormalizedVariant(
                pluginId,
                pluginName,
                r.sourceName || r.name || pluginName,
                r,
                r.streamUrl || r.url || '',
                r.quality || r.maxquality || '',
                r.qualityMap || null,
                typeof r.latency === 'number' ? r.latency : latency,
                mediaMeta
            ));
        }
        return out;
    }

    function buildNormalizedVariant(pluginId, pluginName, sourceName, raw, streamUrl, qualityStr, qualityMap, latency, mediaMeta) {
        var qNum = extractResolutionNumber(qualityStr);
        var voice = safeTrim(raw.translate || raw.voice || '');
        var langCode = detectLanguageCode(raw.lang || raw.language || '', voice);
        var format = safeTrim(raw.format || raw.rip || extractVideoFormat(raw.title || raw.info || ''));
        var subtitles = raw.subtitles || raw.cc || '';
        var hdr = !!(raw.hdr || (qualityStr && String(qualityStr).toLowerCase().indexOf('hdr') !== -1));
        var dv = !!(raw.dv || raw.dolby_vision || (qualityStr && (String(qualityStr).toLowerCase().indexOf('dolby vision') !== -1 || /\bdv\b/i.test(String(qualityStr)))));

        return {
            pluginId: pluginId,
            pluginName: pluginName,
            sourceName: sourceName,
            matchedTitle: raw.title || raw.matchedTitle || (mediaMeta ? mediaMeta.title : ''),
            year: raw.year || (mediaMeta ? mediaMeta.year : ''),
            qualityNum: qNum,                       // 2160 | 1080 | 720 | 480 | 0 (неизвестно)
            qualityLabel: formatQualityLabel(qNum, hdr, dv),
            hdr: hdr,
            dv: dv,
            voice: voice,
            langCode: langCode,                     // 'uk' | 'ru' | 'en' | 'other' | 'unknown'
            langLabel: formatLanguageLabel(langCode),
            format: format,                         // 'WEBRip' | 'WEB-DL' | 'BDRip' | ''
            subtitles: subtitles,
            hasSubtitles: !!(subtitles && (typeof subtitles === 'string' ? subtitles.length : (subtitles.length > 0))),
            season: raw.season || raw.s || '',
            episode: raw.episode || raw.e || '',
            streamUrl: streamUrl || '',
            qualityMap: qualityMap,
            canPlay: !!streamUrl,
            latency: latency || 0
        };
    }

    function extractResolutionNumber(str) {
        if (!str) return 0;
        var s = String(str).toLowerCase();
        if (s.indexOf('2160') !== -1 || s.indexOf('4k') !== -1 || s.indexOf('uhd') !== -1) return 2160;
        if (s.indexOf('1080') !== -1 || s.indexOf('fhd') !== -1 || s.indexOf('full hd') !== -1) return 1080;
        if (s.indexOf('720') !== -1 || /\bhd\b/.test(s)) return 720;
        if (s.indexOf('480') !== -1 || s.indexOf('360') !== -1 || /\bsd\b/.test(s)) return 480;
        return 0;
    }

    function formatQualityLabel(qNum, hdr, dv) {
        var base = qNum === 2160 ? '4K / 2160p' : (qNum === 1080 ? '1080p' : (qNum === 720 ? '720p' : (qNum === 480 ? '480p' : 'Неизвестно')));
        if (dv) base += ' DV';
        if (hdr) base += ' HDR';
        return base;
    }

    function detectLanguageCode(explicitLang, voice) {
        var raw = (String(explicitLang || '') + ' ' + String(voice || '')).toLowerCase();
        if (!safeTrim(raw)) return 'unknown';
        if (/\b(uk|ua|укр|україн|украин)\b/.test(raw) || raw.indexOf('укр') !== -1) return 'uk';
        if (/\b(ru|rus|рус|дубляж|многоголос|одноголос|lostfilm|hdrezka|rhs|red head)\b/.test(raw) || raw.indexOf('рус') !== -1) return 'ru';
        if (/\b(en|eng|english|англ|original|оригинал)\b/.test(raw) || raw.indexOf('англ') !== -1) return 'en';
        return 'other';
    }

    function formatLanguageLabel(code) {
        if (code === 'uk') return 'Украинский';
        if (code === 'ru') return 'Русский';
        if (code === 'en') return 'Английский';
        if (code === 'other') return 'Другой';
        return 'Неизвестно';
    }

    function extractVideoFormat(text) {
        if (!text) return '';
        var m = String(text).match(/\b(WEB-?DL|WEBRip|BDRip|BluRay|HDRip|DVDRip|TS|CAMRip|HLS)\b/i);
        return m ? m[1].toUpperCase() : '';
    }

    function launchPlaybackSafe(result, mediaMeta) {
        if (!result) return false;
        try {
            if (result.streamUrl && window.Lampa && Lampa.Player && typeof Lampa.Player.play === 'function') {
                var playTitle = (mediaMeta && mediaMeta.title ? mediaMeta.title : result.matchedTitle || result.sourceName);
                if (result.season && result.episode) playTitle += ' • S' + result.season + 'E' + result.episode;
                Lampa.Player.play({
                    url: result.streamUrl,
                    title: playTitle,
                    quality: result.qualityMap || undefined,
                    subtitles: result.subtitles || undefined
                });
                return true;
            }
        } catch (err) {
            Diagnostics.logError('Player.play', err);
        }
        return CardIntegration.launchPluginLiveButton(result.pluginId);
    }

    // =========================================================================
    // 7. РЕЕСТР АДАПТЕРОВ ИСТОЧНИКОВ (SourceRegistry)
    // =========================================================================
    var SourceRegistry = {
        adapters: {},       // id -> Adapter
        customAdapters: {}, // id -> wrapped Adapter

        resetAndScan: function () {
            var self = this;
            var found = {};
            var unsupported = [];
            var seenUn = {};

            var cid;
            for (cid in self.customAdapters) {
                if (self.customAdapters.hasOwnProperty(cid)) found[cid] = self.customAdapters[cid];
            }

            var rawPlugins = [];
            try {
                var stored = Lampa.Storage.get('plugins', []);
                if (Object.prototype.toString.call(stored) === '[object Array]') rawPlugins = rawPlugins.concat(stored);
            } catch (e1) { Diagnostics.logError('SourceRegistry.storage', e1); }
            try {
                if (Lampa.Manifest && Object.prototype.toString.call(Lampa.Manifest.plugins) === '[object Array]') {
                    rawPlugins = rawPlugins.concat(Lampa.Manifest.plugins);
                }
            } catch (e2) { Diagnostics.logError('SourceRegistry.manifest', e2); }

            var i, j, k, p, pUrl, pName, lowerUrl, lowerName, matched;
            for (i = 0; i < rawPlugins.length; i++) {
                p = rawPlugins[i];
                if (!p) continue;
                if (typeof p === 'string') { pUrl = p; pName = ''; }
                else {
                    if (p.status === 0) continue;
                    pUrl = p.url || p.src || '';
                    pName = p.name || p.title || '';
                }
                if (!pUrl && !pName) continue;
                lowerUrl = String(pUrl).toLowerCase();
                lowerName = String(pName).toLowerCase();
                if (lowerUrl.indexOf('andrprod') !== -1 || lowerName.indexOf('andrprod') !== -1) continue;

                if (isBlacklisted(lowerUrl, lowerName)) {
                    if (!seenUn[pUrl || pName]) {
                        seenUn[pUrl || pName] = true;
                        unsupported.push({ name: pName || extractPluginLabel(pUrl), url: pUrl, reason: 'Не является онлайн-кинотеатром' });
                    }
                    continue;
                }

                matched = null;
                for (j = 0; j < ONLINE_PLUGIN_WHITELIST.length; j++) {
                    var prof = ONLINE_PLUGIN_WHITELIST[j];
                    for (k = 0; k < prof.patterns.length; k++) {
                        if (lowerUrl.indexOf(prof.patterns[k]) !== -1 || lowerName.indexOf(prof.patterns[k]) !== -1) {
                            matched = prof;
                            break;
                        }
                    }
                    if (matched) break;
                }

                if (matched) {
                    if (!found[matched.id]) {
                        var meta = { id: matched.id, name: pName || matched.name, url: pUrl, kind: matched.kind, buttonHints: matched.buttonHints };
                        found[matched.id] = (matched.kind === 'lampac_protocol' || matched.kind === 'lampac_or_native')
                            ? AdapterFactory.createLampacAdapter(meta)
                            : AdapterFactory.createNativeDelegationAdapter(meta);
                    }
                } else {
                    if (!seenUn[pUrl || pName]) {
                        seenUn[pUrl || pName] = true;
                        unsupported.push({ name: pName || extractPluginLabel(pUrl), url: pUrl, reason: 'Нет подтверждённого адаптера онлайн-источника' });
                    }
                }
            }

            Diagnostics.unsupportedPlugins = unsupported;
            self.adapters = found;
            return self.getAdapters();
        },

        registerAdapter: function (rawAdapter) {
            if (!rawAdapter || !rawAdapter.id) return false;
            var wrapped = AdapterFactory.wrapCustomAdapter(rawAdapter);
            this.customAdapters[rawAdapter.id] = wrapped;
            this.adapters[rawAdapter.id] = wrapped;
            return true;
        },

        getAdapters: function () {
            var list = [];
            var id;
            for (id in this.adapters) if (this.adapters.hasOwnProperty(id)) list.push(this.adapters[id]);
            var prio = StorageManager.getPriorities();
            list.sort(function (a, b) {
                var ia = a.getSourceInfo().id;
                var ib = b.getSourceInfo().id;
                var pa = prio.indexOf(ia);
                var pb = prio.indexOf(ib);
                if (pa !== -1 && pb !== -1) return pa - pb;
                if (pa !== -1) return -1;
                if (pb !== -1) return 1;
                return String(a.getSourceInfo().name).localeCompare(String(b.getSourceInfo().name));
            });
            return list;
        },

        getAdapterById: function (id) { return this.adapters[id] || null; }
    };

    // =========================================================================
    // 8. ФИЛЬТРАЦИЯ (ЯЗЫКИ + MIN/MAX КАЧЕСТВО + ОЗВУЧКА + СОРТИРОВКА)
    // =========================================================================
    var FilterEngine = {
        qualityToNum: function (qStr) {
            if (qStr === '4k' || qStr === '2160p') return 2160;
            if (qStr === '1080p') return 1080;
            if (qStr === '720p') return 720;
            if (qStr === '480p') return 480;
            return 0;
        },

        apply: function (results) {
            var langs = StorageManager.getAllowedLanguages();
            var minQ = FilterEngine.qualityToNum(StorageManager.getMinQuality());
            var maxQ = FilterEngine.qualityToNum(StorageManager.getMaxQuality());
            var hideUnmatched = StorageManager.isHideUnmatched();
            var prefVoice = StorageManager.getPrefVoice();

            var out = [];
            var i, r;
            for (i = 0; i < results.length; i++) {
                r = results[i];

                // 1. Языковой фильтр (например, можно отключить английский)
                if (r.langCode === 'uk' && !langs.uk) continue;
                if (r.langCode === 'ru' && !langs.ru) continue;
                if (r.langCode === 'en' && !langs.en) continue;
                if (r.langCode === 'other' && !langs.other) continue;

                // 2. Минимальное / максимальное качество (строго по реальным данным!)
                if (minQ > 0) {
                    if (r.qualityNum === 0 && hideUnmatched) continue;
                    if (r.qualityNum > 0 && r.qualityNum < minQ) continue;
                }
                if (maxQ > 0 && r.qualityNum > maxQ) continue;

                // 3. Предпочитаемая озвучка (если включено скрытие неподходящих)
                if (prefVoice !== 'any' && hideUnmatched && r.voice) {
                    var vLow = r.voice.toLowerCase();
                    if (prefVoice === 'dub' && vLow.indexOf('дубляж') === -1 && vLow.indexOf('dub') === -1) continue;
                    if (prefVoice === 'orig' && vLow.indexOf('оригинал') === -1 && vLow.indexOf('orig') === -1) continue;
                }

                out.push(r);
            }

            return FilterEngine.sort(out, StorageManager.getSortBy());
        },

        sort: function (list, sortBy) {
            var prio = StorageManager.getPriorities();
            var copy = list.slice(0);
            copy.sort(function (a, b) {
                if (sortBy === 'name') return String(a.sourceName).localeCompare(String(b.sourceName));
                if (sortBy === 'quality') {
                    if (a.qualityNum !== b.qualityNum) return b.qualityNum - a.qualityNum;
                    return (a.latency || 99999) - (b.latency || 99999);
                }
                if (sortBy === 'speed') {
                    return (a.latency || 99999) - (b.latency || 99999);
                }
                var pa = prio.indexOf(a.pluginId);
                var pb = prio.indexOf(b.pluginId);
                if (pa !== -1 && pb !== -1 && pa !== pb) return pa - pb;
                if (pa !== -1 && pb === -1) return -1;
                if (pb !== -1 && pa === -1) return 1;
                if (a.qualityNum !== b.qualityNum) return b.qualityNum - a.qualityNum;
                return String(a.sourceName).localeCompare(String(b.sourceName));
            });
            return copy;
        }
    };

    // =========================================================================
    // 9. ЕДИНЫЙ ПАРАЛЛЕЛЬНЫЙ ПОИСК И КЕШ РЕЗУЛЬТАТОВ (UnifiedSearchEngine)
    // =========================================================================
    var SearchCache = {
        TTL_MS: 300000, // 5 минут
        store: {},
        makeKey: function (meta, scopeId) {
            return (meta.mediaType || 'movie') + ':' + (meta.tmdbId || meta.title) + ':' + (scopeId || 'all');
        },
        get: function (meta, scopeId) {
            var entry = SearchCache.store[SearchCache.makeKey(meta, scopeId)];
            if (entry && (Date.now() - entry.savedAt) < SearchCache.TTL_MS) return entry.state;
            return null;
        },
        set: function (meta, scopeId, state) {
            SearchCache.store[SearchCache.makeKey(meta, scopeId)] = { savedAt: Date.now(), state: state };
        },
        clear: function (meta, scopeId) {
            delete SearchCache.store[SearchCache.makeKey(meta, scopeId)];
        }
    };

    var UnifiedSearchEngine = {
        activeSessionId: 0,
        activeNetHandles: [],
        activeTimers: [],

        cancelActiveSearch: function () {
            UnifiedSearchEngine.activeSessionId++;
            var i;
            for (i = 0; i < UnifiedSearchEngine.activeNetHandles.length; i++) {
                try { UnifiedSearchEngine.activeNetHandles[i].clear(); } catch (e) {}
            }
            for (i = 0; i < UnifiedSearchEngine.activeTimers.length; i++) {
                try { clearTimeout(UnifiedSearchEngine.activeTimers[i]); } catch (e2) {}
            }
            UnifiedSearchEngine.activeNetHandles = [];
            UnifiedSearchEngine.activeTimers = [];
            return UnifiedSearchEngine.activeSessionId;
        },
        _trackNet: function (net) { if (net) UnifiedSearchEngine.activeNetHandles.push(net); },
        _trackTimer: function (t) { if (t) UnifiedSearchEngine.activeTimers.push(t); },

        /**
         * Параллельный поиск по всем разрешённым источникам (или по одному выбранному scopePluginId).
         */
        search: function (card, explicitMethod, scopePluginId, forceRefresh, callbacks) {
            callbacks = callbacks || {};
            var mediaMeta = TitleResolver.extractMediaMeta(card, explicitMethod);
            var scope = scopePluginId || 'all';

            if (!forceRefresh) {
                var cached = SearchCache.get(mediaMeta, scope);
                if (cached) {
                    if (callbacks.onComplete) callbacks.onComplete(cached);
                    return cached;
                }
            } else {
                SearchCache.clear(mediaMeta, scope);
            }

            var sessionId = UnifiedSearchEngine.cancelActiveSearch();
            var t0 = Date.now();
            SourceRegistry.resetAndScan();

            var allAdapters = SourceRegistry.getAdapters();
            var targetAdapters = [];
            var i;
            for (i = 0; i < allAdapters.length; i++) {
                var info = allAdapters[i].getSourceInfo();
                // Строго не отправляем запросы отключённым источникам!
                if (!StorageManager.isSourceEnabled(info.id)) continue;
                if (scope !== 'all' && info.id !== scope) continue;
                targetAdapters.push(allAdapters[i]);
            }

            var state = {
                sessionId: sessionId,
                mediaMeta: mediaMeta,
                scope: scope,
                statusText: targetAdapters.length ? 'Поиск источников...' : 'Нет активных источников',
                isSearching: targetAdapters.length > 0,
                cancelled: false,
                statuses: {},
                results: [],
                completed: 0,
                total: targetAdapters.length,
                durationMs: 0
            };

            if (!targetAdapters.length) {
                Diagnostics.lastSearchAt = Date.now();
                Diagnostics.lastSearchDurationMs = 0;
                Diagnostics.lastResultCount = 0;
                if (callbacks.onComplete) callbacks.onComplete(state);
                return state;
            }

            for (i = 0; i < targetAdapters.length; i++) {
                var inf = targetAdapters[i].getSourceInfo();
                state.statuses[inf.id] = { info: inf, status: 'searching', label: 'Поиск...', count: 0, error: '' };
            }
            if (callbacks.onUpdate) callbacks.onUpdate(state);

            for (i = 0; i < targetAdapters.length; i++) {
                (function (adapter) {
                    var info = adapter.getSourceInfo();
                    var searchFn = mediaMeta.isSeries ? adapter.searchSeries : adapter.searchMovie;
                    searchFn(mediaMeta, { sessionId: sessionId }, function (outcome) {
                        if (sessionId !== UnifiedSearchEngine.activeSessionId) return;

                        outcome = outcome || { status: 'error', error: 'Пустой ответ адаптера', results: [] };
                        var list = outcome.results || [];
                        state.statuses[info.id] = {
                            info: info,
                            status: outcome.status,
                            label: outcome.status === 'found' ? ('Найдено: ' + list.length)
                                : (outcome.status === 'empty' ? 'Ничего не найдено'
                                : (outcome.status === 'unsupported' ? 'Только кнопка плагина' : 'Ошибка')),
                            count: list.length,
                            error: outcome.error || ''
                        };

                        if (list.length) {
                            state.results = UnifiedSearchEngine.deduplicate(state.results, list);
                        }

                        state.completed++;
                        state.durationMs = Date.now() - t0;
                        state.statusText = state.completed < state.total
                            ? ('Источник ' + info.name + ' завершил поиск (' + state.completed + '/' + state.total + ') • Найдено: ' + state.results.length)
                            : ('Поиск завершён • Найдено вариантов: ' + state.results.length);

                        if (state.completed >= state.total) {
                            state.isSearching = false;
                            Diagnostics.lastSearchAt = Date.now();
                            Diagnostics.lastSearchDurationMs = state.durationMs;
                            Diagnostics.lastResultCount = state.results.length;
                            SearchCache.set(mediaMeta, scope, state);
                            if (callbacks.onComplete) callbacks.onComplete(state);
                        } else if (callbacks.onUpdate) {
                            callbacks.onUpdate(state);
                        }
                    });
                })(targetAdapters[i]);
            }

            return state;
        },

        /**
         * Удаляет точные дубликаты, сохраняя разные озвучки, качества, форматы и источники.
         */
        deduplicate: function (existing, incoming) {
            var seen = {};
            var out = [];
            var all = (existing || []).concat(incoming || []);
            var i, r, sig;
            for (i = 0; i < all.length; i++) {
                r = all[i];
                sig = [
                    r.pluginId,
                    String(r.sourceName || '').toLowerCase(),
                    String(r.qualityNum || 0),
                    String(r.voice || '').toLowerCase(),
                    String(r.langCode || ''),
                    String(r.format || '').toLowerCase(),
                    String(r.season || ''),
                    String(r.episode || ''),
                    safeTrim(r.streamUrl)
                ].join('|');
                if (!seen[sig]) {
                    seen[sig] = true;
                    out.push(r);
                }
            }
            return out;
        },

        checkAllSources: function (onEach, onDone) {
            SourceRegistry.resetAndScan();
            var adapters = SourceRegistry.getAdapters();
            var total = adapters.length;
            if (!total) { if (onDone) onDone({}); return; }
            var finished = 0;
            var results = {};
            var i;
            for (i = 0; i < total; i++) {
                (function (ad) {
                    var info = ad.getSourceInfo();
                    ad.isAvailable(function (ok, msg, latency) {
                        var rec = { id: info.id, name: info.name, ok: !!ok, message: msg || '', latency: latency || 0, checkedAt: Date.now() };
                        results[info.id] = rec;
                        Diagnostics.lastCheckResults[info.id] = rec;
                        finished++;
                        if (onEach) onEach(rec);
                        if (finished >= total && onDone) onDone(results);
                    });
                })(adapters[i]);
            }
        }
    };

    // =========================================================================
    // 10. КАРТОЧКА ФИЛЬМА/СЕРИАЛА И ФИКС ПОВТОРНОГО НАЖАТИЯ (CardIntegration)
    // =========================================================================
    var CardIntegration = {
        initialized: false,
        lastMovie: null,
        lastMethod: '',

        init: function () {
            if (CardIntegration.initialized) return;
            if (!Lampa.Listener || typeof Lampa.Listener.follow !== 'function') {
                Diagnostics.logError('CardIntegration', 'Lampa.Listener.follow недоступен');
                return;
            }
            CardIntegration.initialized = true;
            Diagnostics.cardIntegrationActive = true;

            Lampa.Listener.follow('full', function (e) {
                if (e && e.type === 'complite') {
                    Diagnostics.lastCardEventAt = Date.now();
                    try { CardIntegration.attachToCard(e); }
                    catch (err) { Diagnostics.logError('CardIntegration.attach', err); }
                }
            });
        },

        attachToCard: function (event) {
            var render = event.object && event.object.activity && typeof event.object.activity.render === 'function'
                ? event.object.activity.render()
                : null;
            if (!render || !render.length) return;

            var container = render.find('.full-start-new__buttons');
            if (!container.length) container = render.find('.full-start__buttons');
            if (!container.length) return;

            container.find('.andrprod-card-btn').off('hover:enter').remove();

            var movie = (event.data && event.data.movie) ? event.data.movie : (event.object && event.object.card ? event.object.card : {});
            var method = (event.object && event.object.method) ? event.object.method : '';
            CardIntegration.lastMovie = movie;
            CardIntegration.lastMethod = method;

            var btn = $(
                '<div class="full-start__button selector andrprod-card-btn" data-andrprod="1">' +
                    BrandIcons.getLogoSvg('andrprod-card-btn__logo', 'card_' + (movie.id || '0')) +
                '</div>'
            );
            container.prepend(btn);

            btn.on('hover:enter', function () {
                Lampa.Activity.push({
                    url: '',
                    title: PLUGIN_NAME,
                    component: SEARCH_COMPONENT,
                    movie: movie,
                    method: method,
                    scope: 'all',
                    page: 1
                });
            });
        },

        /**
         * ИСПРАВЛЕНИЕ БАГА ПОВТОРНОГО НАЖАТИЯ (Раздел 9):
         * Всегда ищет ЖИВУЮ прикреплённую кнопку в активном DOM карточки фильма/сериала.
         * Если открыт экран ANDRPROD поверх карточки — сначала безопасно возвращается
         * в карточку через Lampa.Activity.backward(), затем нажимает живую кнопку плагина.
         */
        launchPluginLiveButton: function (pluginId) {
            var prof = null;
            var i;
            for (i = 0; i < ONLINE_PLUGIN_WHITELIST.length; i++) {
                if (ONLINE_PLUGIN_WHITELIST[i].id === pluginId) { prof = ONLINE_PLUGIN_WHITELIST[i]; break; }
            }
            var hints = prof ? prof.buttonHints : [pluginId];

            function findAndTriggerLive() {
                var btns = $('.full-start-new__buttons .full-start__button, .full-start__buttons .full-start__button, .full-start-new__buttons [class*="lampac--button"], .full-start__buttons [class*="lampac--button"]');
                var matchedEl = null;
                btns.each(function () {
                    if (matchedEl) return;
                    var el = $(this);
                    if (el.hasClass('andrprod-card-btn')) return;
                    var txt = safeTrim(el.find('span').text() || el.attr('aria-label') || el.attr('title') || el.text()).toLowerCase();
                    var cls = String(el.attr('class') || '').toLowerCase();
                    var h;
                    for (h = 0; h < hints.length; h++) {
                        if (txt.indexOf(hints[h]) !== -1 || cls.indexOf(hints[h]) !== -1) {
                            matchedEl = el;
                            return;
                        }
                    }
                });
                if (matchedEl && matchedEl.length) {
                    if (Lampa.Noty) Lampa.Noty.show(PLUGIN_NAME + ' → ' + (prof ? prof.name : pluginId));
                    matchedEl.trigger('hover:enter');
                    return true;
                }
                return false;
            }

            if (findAndTriggerLive()) return true;

            // Если находимся на экране ANDRPROD поверх карточки — возвращаемся в карточку и нажимаем живую кнопку
            try {
                if (Lampa.Activity && typeof Lampa.Activity.backward === 'function') {
                    Lampa.Activity.backward();
                    var attempts = 0;
                    var retryTimer = setInterval(function () {
                        attempts++;
                        if (findAndTriggerLive()) {
                            clearInterval(retryTimer);
                            return;
                        }
                        if (attempts >= 12) {
                            clearInterval(retryTimer);
                            if (Lampa.Noty) Lampa.Noty.show(PLUGIN_NAME + ': Кнопка плагина «' + (prof ? prof.name : pluginId) + '» не найдена в карточке.');
                        }
                    }, 250);
                    return true;
                }
            } catch (e) {
                Diagnostics.logError('CardIntegration.liveButton', e);
            }
            return false;
        }
    };

    // =========================================================================
    // 11. ГЛАВНЫЙ ЭКРАН АГРЕГАТОРА (AndrprodSearchComponent)
    // =========================================================================
    function AndrprodSearchComponent(object) {
        var movie = (object && object.movie) ? object.movie : (CardIntegration.lastMovie || {});
        var method = (object && object.method) ? object.method : (CardIntegration.lastMethod || '');
        var scope = (object && object.scope) ? object.scope : 'all';
        var mediaMeta = TitleResolver.extractMediaMeta(movie, method);

        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var html = $('<div class="andrprod-hub"></div>');
        var headerEl = null;
        var statusEl = null;
        var bodyEl = null;
        var lastFocused = null;
        var state = null;
        var isDestroyed = false;

        this.create = function () {
            buildShell();
            if (StorageManager.getSearchMode() !== 'manual') {
                startSearch(false);
            } else {
                renderBody();
            }
            return this.render();
        };

        function startSearch(forceRefresh) {
            state = UnifiedSearchEngine.search(movie, method, scope, forceRefresh, {
                onUpdate: function (st) { if (!isDestroyed) { state = st; renderStatusAndBody(true); } },
                onComplete: function (st) { if (!isDestroyed) { state = st; renderStatusAndBody(true); } }
            });
            renderStatusAndBody(false);
        }

        function buildShell() {
            html.empty();
            var posterStyle = mediaMeta.poster ? ('background-image:url(\'' + mediaMeta.poster + '\')') : '';
            headerEl = $(
                '<div class="andrprod-hero">' +
                    '<div class="andrprod-hero__poster" style="' + posterStyle + '"></div>' +
                    '<div class="andrprod-hero__info">' +
                        BrandIcons.getLogoSvg('andrprod-hero__logo', 'search') +
                        '<div class="andrprod-hero__title">' + escapeHtml(mediaMeta.title) + (mediaMeta.year ? ' (' + escapeHtml(mediaMeta.year) + ')' : '') + '</div>' +
                        '<div class="andrprod-hero__meta">' +
                            (mediaMeta.isSeries ? 'Сериал' : 'Фильм') +
                            (mediaMeta.originalTitle && mediaMeta.originalTitle !== mediaMeta.title ? ' • ' + escapeHtml(mediaMeta.originalTitle) : '') +
                            (mediaMeta.rating ? ' • ★ ' + escapeHtml(mediaMeta.rating) : '') +
                            (mediaMeta.numberOfSeasons ? ' • Сезонов: ' + mediaMeta.numberOfSeasons : '') +
                        '</div>' +
                        '<div class="andrprod-hero__status"></div>' +
                        '<div class="andrprod-hero__actions">' +
                            '<div class="andrprod-pill selector andrprod-act-search">Обновить поиск</div>' +
                            '<div class="andrprod-pill selector andrprod-act-cancel">Отменить поиск</div>' +
                            '<div class="andrprod-pill selector andrprod-act-scope">Источник: ' + escapeHtml(getScopeName(scope)) + '</div>' +
                            '<div class="andrprod-pill selector andrprod-act-sources">Выбрать источники</div>' +
                            '<div class="andrprod-pill selector andrprod-act-diag">Диагностика</div>' +
                        '</div>' +
                    '</div>' +
                '</div>'
            );

            statusEl = headerEl.find('.andrprod-hero__status');
            headerEl.find('.andrprod-act-search').on('hover:enter', function () { startSearch(true); });
            headerEl.find('.andrprod-act-cancel').on('hover:enter', function () {
                UnifiedSearchEngine.cancelActiveSearch();
                if (state) { state.isSearching = false; state.cancelled = true; state.statusText = 'Поиск отменён пользователем'; }
                renderStatusAndBody(true);
            });
            headerEl.find('.andrprod-act-scope').on('hover:enter', openScopePicker);
            headerEl.find('.andrprod-act-sources').on('hover:enter', function () { HubLauncher.open({ view: 'sources' }); });
            headerEl.find('.andrprod-act-diag').on('hover:enter', function () { HubLauncher.open({ view: 'diagnostics' }); });

            bodyEl = $('<div class="andrprod-hub__body"></div>');
            scroll.append(bodyEl);
            html.append(headerEl);
            html.append(scroll.render());
        }

        function openScopePicker() {
            SourceRegistry.resetAndScan();
            var adapters = SourceRegistry.getAdapters();
            var items = [{ title: 'Все источники (общий поиск)', id: 'all', selected: scope === 'all' }];
            var i;
            for (i = 0; i < adapters.length; i++) {
                var inf = adapters[i].getSourceInfo();
                if (!StorageManager.isSourceEnabled(inf.id)) continue;
                items.push({ title: 'Только ' + inf.name, id: inf.id, selected: scope === inf.id });
            }
            Lampa.Select.show({
                title: 'Где искать',
                items: items,
                onSelect: function (item) {
                    scope = item.id;
                    headerEl.find('.andrprod-act-scope').text('Источник: ' + getScopeName(scope));
                    Lampa.Controller.toggle('content');
                    startSearch(false);
                },
                onBack: function () { Lampa.Controller.toggle('content'); }
            });
        }

        function renderStatusAndBody(preserveFocus) {
            if (statusEl) {
                if (!state) statusEl.text('Нажмите «Обновить поиск» для запуска (ручной режим)');
                else statusEl.text(state.statusText + (state.durationMs ? (' • ' + state.durationMs + ' мс') : ''));
            }
            renderBody(preserveFocus);
        }

        function renderBody(preserveFocus) {
            if (isDestroyed || !bodyEl) return;
            bodyEl.empty();

            var rawResults = state ? state.results : [];
            var filtered = FilterEngine.apply(rawResults);

            bodyEl.append('<div class="andrprod-section-title">Найденные варианты (' + filtered.length + (rawResults.length !== filtered.length ? (' из ' + rawResults.length) : '') + ')</div>');

            if (filtered.length) {
                var list = $('<div class="andrprod-source-list"></div>');
                var i;
                for (i = 0; i < filtered.length; i++) {
                    (function (res) {
                        var card = $(
                            '<div class="andrprod-source-card selector">' +
                                '<div class="andrprod-source-card__main">' +
                                    '<div class="andrprod-source-card__header">' +
                                        '<span class="andrprod-plugin-tag">' + escapeHtml(res.pluginName) + '</span>' +
                                        '<span class="andrprod-source-card__title">' + escapeHtml(res.sourceName) + '</span>' +
                                        '<span class="andrprod-chip"><b>' + escapeHtml(res.qualityLabel) + '</b></span>' +
                                        (res.format ? '<span class="andrprod-chip">' + escapeHtml(res.format) + '</span>' : '') +
                                    '</div>' +
                                    '<div class="andrprod-chips-row">' +
                                        (res.voice ? '<span class="andrprod-chip">Озвучка: <b>' + escapeHtml(res.voice) + '</b></span>' : '') +
                                        '<span class="andrprod-chip">Язык: <b>' + escapeHtml(res.langLabel) + '</b></span>' +
                                        (res.hasSubtitles ? '<span class="andrprod-chip">Субтитры: <b class="is-yes">Да</b></span>' : '') +
                                        (res.season ? '<span class="andrprod-chip">S' + escapeHtml(res.season) + (res.episode ? 'E' + escapeHtml(res.episode) : '') + '</span>' : '') +
                                        '<span class="andrprod-chip">Воспроизведение: <b class="' + (res.canPlay ? 'is-yes' : 'is-unk') + '">' + (res.canPlay ? 'Доступно' : 'Через плагин') + '</b></span>' +
                                    '</div>' +
                                '</div>' +
                                '<div class="andrprod-source-card__right"><span class="andrprod-badge is-on">▶ Смотреть</span></div>' +
                            '</div>'
                        );
                        card.on('hover:enter', function () {
                            var ad = SourceRegistry.getAdapterById(res.pluginId);
                            if (ad && typeof ad.play === 'function') ad.play(res, mediaMeta);
                            else launchPlaybackSafe(res, mediaMeta);
                        });
                        card.on('hover:focus', function () { lastFocused = card[0]; scroll.update(card, true); });
                        list.append(card);
                    })(filtered[i]);
                }
                bodyEl.append(list);
            } else {
                bodyEl.append('<div class="andrprod-empty"><div class="andrprod-empty__title">' + (state && state.isSearching ? 'Идёт параллельный поиск по источникам...' : 'Прямых вариантов воспроизведения не найдено') + '</div><div class="andrprod-empty__desc">Если у установленного плагина нет программного API, откройте его напрямую из списка статусов ниже.</div></div>');
            }

            // Статусы каждого источника (если включено отображение процесса поиска)
            if (state && StorageManager.isShowProgress()) {
                bodyEl.append('<div class="andrprod-section-title">Состояние источников (' + state.completed + '/' + state.total + ')</div>');
                var sList = $('<div class="andrprod-source-list"></div>');
                var sid;
                for (sid in state.statuses) {
                    if (!state.statuses.hasOwnProperty(sid)) continue;
                    (function (st) {
                        var row = $(
                            '<div class="andrprod-source-card selector">' +
                                '<div class="andrprod-source-card__main">' +
                                    '<div class="andrprod-source-card__header">' +
                                        '<span class="andrprod-status-dot ' + mapStatusDot(st.status) + '"></span>' +
                                        '<span class="andrprod-source-card__title">' + escapeHtml(st.info.name) + '</span>' +
                                        '<span class="andrprod-chip">' + escapeHtml(st.label) + '</span>' +
                                    '</div>' +
                                    (st.error ? '<div class="andrprod-source-card__sub">' + escapeHtml(st.error) + '</div>' : '') +
                                '</div>' +
                                '<div class="andrprod-source-card__right"><span class="andrprod-badge is-off">' + (st.status === 'unsupported' ? '▶ Открыть в плагине' : 'Инфо') + '</span></div>' +
                            '</div>'
                        );
                        row.on('hover:enter', function () {
                            if (st.status === 'unsupported') CardIntegration.launchPluginLiveButton(st.info.id);
                            else HubLauncher.open({ view: 'sources' });
                        });
                        row.on('hover:focus', function () { lastFocused = row[0]; scroll.update(row, true); });
                        sList.append(row);
                    })(state.statuses[sid]);
                }
                bodyEl.append(sList);
            }

            Lampa.Controller.collectionSet(html);
            if (!preserveFocus) {
                var first = html.find('.selector')[0];
                if (first) Lampa.Controller.collectionFocus(first, html);
            }
        }

        function getScopeName(id) {
            if (!id || id === 'all') return 'Все';
            var ad = SourceRegistry.getAdapterById(id);
            return ad ? ad.getSourceInfo().name : id;
        }

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(html);
                    Lampa.Controller.collectionFocus(lastFocused || html.find('.selector')[0] || false, html);
                },
                left: function () { if (typeof Navigator !== 'undefined' && Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
                right: function () { if (typeof Navigator !== 'undefined') Navigator.move('right'); },
                up: function () { if (typeof Navigator !== 'undefined' && Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
                down: function () { if (typeof Navigator !== 'undefined') Navigator.move('down'); },
                back: function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
        };
        this.pause = function () {};
        this.stop = function () {};
        this.render = function () { return html; };
        this.destroy = function () {
            isDestroyed = true;
            UnifiedSearchEngine.cancelActiveSearch();
            try { scroll.destroy(); } catch (e) {}
            html.remove();
        };
    }

    // =========================================================================
    // 12. РАЗДЕЛЫ «ВЫБРАТЬ ИСТОЧНИКИ» И «ДИАГНОСТИКА» (AndrprodHubComponent)
    // =========================================================================
    var HubLauncher = {
        open: function (params) {
            params = params || {};
            Lampa.Activity.push({
                url: '',
                title: PLUGIN_NAME,
                component: HUB_COMPONENT,
                view: params.view || 'sources',
                page: 1
            });
        }
    };

    function AndrprodHubComponent(object) {
        var currentView = (object && object.view) ? object.view : 'sources';
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var html = $('<div class="andrprod-hub"></div>');
        var bodyEl = null;
        var lastFocused = null;
        var isDestroyed = false;

        this.create = function () {
            SourceRegistry.resetAndScan();
            buildShell();
            renderView();
            return this.render();
        };

        function buildShell() {
            html.empty();
            var head = $(
                '<div class="andrprod-hub__header">' +
                    '<div class="andrprod-hub__brand">' + BrandIcons.getLogoSvg('andrprod-hub__logo', 'hub') + '</div>' +
                    '<div class="andrprod-hub__toolbar">' +
                        '<div class="andrprod-pill selector andrprod-tab-src">Выбрать источники</div>' +
                        '<div class="andrprod-pill selector andrprod-tab-diag">Диагностика</div>' +
                        '<div class="andrprod-pill selector andrprod-btn-checkall">Проверить все источники</div>' +
                    '</div>' +
                '</div>'
            );
            head.find('.andrprod-tab-src').on('hover:enter', function () { currentView = 'sources'; renderView(); });
            head.find('.andrprod-tab-diag').on('hover:enter', function () { currentView = 'diagnostics'; renderView(); });
            head.find('.andrprod-btn-checkall').on('hover:enter', function () {
                if (Lampa.Noty) Lampa.Noty.show(PLUGIN_NAME + ': Проверка всех источников...');
                UnifiedSearchEngine.checkAllSources(function () {
                    if (!isDestroyed) renderView(true);
                }, function () {
                    if (!isDestroyed) {
                        renderView(true);
                        if (Lampa.Noty) Lampa.Noty.show(PLUGIN_NAME + ': Проверка завершена.');
                    }
                });
            });
            bodyEl = $('<div class="andrprod-hub__body"></div>');
            scroll.append(bodyEl);
            html.append(head);
            html.append(scroll.render());
        }

        function renderView(preserveFocus) {
            if (isDestroyed || !bodyEl) return;
            bodyEl.empty();
            if (currentView === 'diagnostics') renderDiagnostics();
            else renderSelectSources();

            Lampa.Controller.collectionSet(html);
            if (!preserveFocus) {
                var first = bodyEl.find('.selector')[0] || html.find('.selector')[0];
                if (first) Lampa.Controller.collectionFocus(first, html);
            }
        }

        function renderSelectSources() {
            var adapters = SourceRegistry.getAdapters();
            bodyEl.append('<div class="andrprod-section-title">Выбрать источники (' + adapters.length + ')</div>');
            if (!adapters.length) {
                bodyEl.append('<div class="andrprod-empty"><div class="andrprod-empty__title">Онлайн-источники не обнаружены</div><div class="andrprod-empty__desc">Установите совместимые онлайн-плагины в Lampa → Настройки → Расширения.</div></div>');
                return;
            }
            var list = $('<div class="andrprod-source-list"></div>');
            var i;
            for (i = 0; i < adapters.length; i++) {
                (function (ad, idx) {
                    var info = ad.getSourceInfo();
                    var enabled = StorageManager.isSourceEnabled(info.id);
                    var chk = Diagnostics.lastCheckResults[info.id];
                    var row = $(
                        '<div class="andrprod-source-card selector ' + (enabled ? '' : 'is-disabled') + '">' +
                            '<div class="andrprod-source-card__main">' +
                                '<div class="andrprod-source-card__header">' +
                                    '<span class="andrprod-status-dot ' + (chk ? (chk.ok ? 'is-online' : 'is-offline') : 'is-unknown') + '"></span>' +
                                    '<span class="andrprod-source-card__title">#' + (idx + 1) + ' ' + escapeHtml(info.name) + '</span>' +
                                    '<span class="andrprod-chip">' + (info.integrationLevel === 'full' ? 'Полная интеграция' : 'Кнопка плагина') + '</span>' +
                                '</div>' +
                                '<div class="andrprod-source-card__sub">' +
                                    (chk ? (escapeHtml(chk.message) + ' (' + chk.latency + ' мс) • ') : '') +
                                    escapeHtml(info.reason) +
                                '</div>' +
                            '</div>' +
                            '<div class="andrprod-source-card__right"><span class="andrprod-badge ' + (enabled ? 'is-on' : 'is-off') + '">' + (enabled ? 'Включён' : 'Отключён') + '</span></div>' +
                        '</div>'
                    );
                    row.on('hover:enter', function () {
                        Lampa.Select.show({
                            title: info.name,
                            items: [
                                { title: enabled ? 'Отключить источник' : 'Включить источник', act: 'toggle' },
                                { title: 'Проверить доступность', act: 'check' },
                                { title: 'Поднять приоритет ▲', act: 'up' },
                                { title: 'Понизить приоритет ▼', act: 'down' }
                            ],
                            onSelect: function (it) {
                                if (it.act === 'toggle') StorageManager.setSourceEnabled(info.id, !enabled);
                                else if (it.act === 'up') StorageManager.movePriority(info.id, -1);
                                else if (it.act === 'down') StorageManager.movePriority(info.id, 1);
                                else if (it.act === 'check') {
                                    ad.isAvailable(function (ok, msg, lat) {
                                        Diagnostics.lastCheckResults[info.id] = { id: info.id, name: info.name, ok: !!ok, message: msg, latency: lat, checkedAt: Date.now() };
                                        if (Lampa.Noty) Lampa.Noty.show(info.name + ': ' + msg);
                                        if (!isDestroyed) renderView(true);
                                    });
                                }
                                renderView(true);
                                Lampa.Controller.toggle('content');
                            },
                            onBack: function () { Lampa.Controller.toggle('content'); }
                        });
                    });
                    row.on('hover:focus', function () { lastFocused = row[0]; scroll.update(row, true); });
                    list.append(row);
                })(adapters[i], i);
            }
            bodyEl.append(list);
        }

        function renderDiagnostics() {
            var rep = Diagnostics.getReport();
            var list = $('<div class="andrprod-settings-list"></div>');
            var metrics = [
                { k: 'Версия плагина', v: 'v' + rep.version },
                { k: 'Состояние загрузки / инициализации', v: (rep.loaded ? 'Загружен' : 'Нет') + ' / ' + (rep.initialized ? 'Инициализирован' : 'Ошибка') },
                { k: 'Обнаружено / Активных / Неподдерживаемых', v: rep.discoveredCount + ' / ' + rep.activeCount + ' / ' + rep.unsupportedCount },
                { k: 'Последняя ошибка', v: rep.lastError ? ('[' + rep.lastError.module + '] ' + rep.lastError.message) : 'Нет' },
                { k: 'Время последнего поиска', v: rep.lastSearchAt ? (formatTime(rep.lastSearchAt) + ' (' + rep.lastSearchDurationMs + ' мс, найдено: ' + rep.lastResultCount + ')') : 'Не выполнялся' }
            ];
            var i;
            for (i = 0; i < metrics.length; i++) {
                list.append('<div class="andrprod-setting-row"><div class="andrprod-setting-row__title">' + escapeHtml(metrics[i].k) + '</div><div class="andrprod-setting-row__val">' + escapeHtml(metrics[i].v) + '</div></div>');
            }
            bodyEl.append(list);

            var chkKeys = Object.keys(rep.lastCheckResults || {});
            if (chkKeys.length) {
                bodyEl.append('<div class="andrprod-section-title">Результаты проверки источников (' + chkKeys.length + ')</div>');
                var cList = $('<div class="andrprod-source-list"></div>');
                for (i = 0; i < chkKeys.length; i++) {
                    var c = rep.lastCheckResults[chkKeys[i]];
                    cList.append('<div class="andrprod-source-card"><div class="andrprod-source-card__main"><div class="andrprod-source-card__header"><span class="andrprod-status-dot ' + (c.ok ? 'is-online' : 'is-offline') + '"></span><span class="andrprod-source-card__title">' + escapeHtml(c.name) + '</span></div><div class="andrprod-source-card__sub">' + escapeHtml(c.message) + ' • ' + c.latency + ' мс</div></div></div>');
                }
                bodyEl.append(cList);
            }
        }

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(html);
                    Lampa.Controller.collectionFocus(lastFocused || html.find('.selector')[0] || false, html);
                },
                left: function () { if (typeof Navigator !== 'undefined' && Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
                right: function () { if (typeof Navigator !== 'undefined') Navigator.move('right'); },
                up: function () { if (typeof Navigator !== 'undefined' && Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
                down: function () { if (typeof Navigator !== 'undefined') Navigator.move('down'); },
                back: function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
        };
        this.pause = function () {};
        this.stop = function () {};
        this.render = function () { return html; };
        this.destroy = function () { isDestroyed = true; try { scroll.destroy(); } catch (e) {} html.remove(); };
    }

    // =========================================================================
    // 13. НАСТРОЙКИ В LAMPA (Lampa → Настройки → ANDRPROD DD)
    // =========================================================================
    var SettingsIntegration = {
        init: function () {
            if (!Lampa.SettingsApi) return;
            try {
                Lampa.SettingsApi.addComponent({ component: PLUGIN_ID, name: PLUGIN_NAME, icon: BrandIcons.getMiniIconSvg() });

                // --- Источники ---
                Lampa.SettingsApi.addParam({
                    component: PLUGIN_ID,
                    param: { name: 'andrprod_dd_btn_sources', type: 'button' },
                    field: { name: 'Выбрать источники', description: 'Включение, отключение, приоритет и проверка доступности источников' },
                    onChange: function () { HubLauncher.open({ view: 'sources' }); }
                });
                Lampa.SettingsApi.addParam({
                    component: PLUGIN_ID,
                    param: { name: 'andrprod_dd_btn_checkall', type: 'button' },
                    field: { name: 'Проверить все источники', description: 'Запустить проверку работоспособности всех источников' },
                    onChange: function () { HubLauncher.open({ view: 'diagnostics' }); UnifiedSearchEngine.checkAllSources(); }
                });

                // --- Языки ---
                Lampa.SettingsApi.addParam({ component: PLUGIN_ID, param: { name: STORAGE_KEYS.langUk, type: 'trigger', 'default': true }, field: { name: 'Язык: Украинский', description: 'Показывать варианты с украинской озвучкой' } });
                Lampa.SettingsApi.addParam({ component: PLUGIN_ID, param: { name: STORAGE_KEYS.langRu, type: 'trigger', 'default': true }, field: { name: 'Язык: Русский', description: 'Показывать варианты с русской озвучкой' } });
                Lampa.SettingsApi.addParam({ component: PLUGIN_ID, param: { name: STORAGE_KEYS.langEn, type: 'trigger', 'default': true }, field: { name: 'Язык: Английский', description: 'Отключите, чтобы скрыть английские источники и озвучку' } });
                Lampa.SettingsApi.addParam({ component: PLUGIN_ID, param: { name: STORAGE_KEYS.langOther, type: 'trigger', 'default': true }, field: { name: 'Язык: Другие языки', description: 'Показывать остальные языки озвучки' } });

                // --- Фильтрация и качество ---
                Lampa.SettingsApi.addParam({
                    component: PLUGIN_ID,
                    param: { name: STORAGE_KEYS.minQuality, type: 'select', values: { any: 'Не имеет значения', '480p': '480p', '720p': '720p', '1080p': '1080p', '2160p': '2160p', '4k': '4K' }, 'default': 'any' },
                    field: { name: 'Минимальное качество видео', description: 'Отсеивать варианты ниже выбранного качества' }
                });
                Lampa.SettingsApi.addParam({
                    component: PLUGIN_ID,
                    param: { name: STORAGE_KEYS.maxQuality, type: 'select', values: { any: 'Не имеет значения', '4k': '4K', '2160p': '2160p', '1080p': '1080p', '720p': '720p', '480p': '480p' }, 'default': 'any' },
                    field: { name: 'Максимальное качество видео', description: 'Ограничить верхнее разрешение видео' }
                });
                Lampa.SettingsApi.addParam({
                    component: PLUGIN_ID,
                    param: { name: STORAGE_KEYS.prefVoice, type: 'select', values: { any: 'Любая', dub: 'Дубляж', multi: 'Многоголосая', orig: 'Оригинал' }, 'default': 'any' },
                    field: { name: 'Предпочитаемая озвучка', description: 'Приоритетный тип озвучки при фильтрации' }
                });
                Lampa.SettingsApi.addParam({ component: PLUGIN_ID, param: { name: STORAGE_KEYS.hideUnavailable, type: 'trigger', 'default': false }, field: { name: 'Скрывать недоступные источники', description: 'Не показывать источники, не прошедшие проверку' } });
                Lampa.SettingsApi.addParam({ component: PLUGIN_ID, param: { name: STORAGE_KEYS.hideUnmatched, type: 'trigger', 'default': true }, field: { name: 'Скрывать неподходящие варианты', description: 'Скрывать результаты с неизвестным качеством при активном фильтре' } });
                Lampa.SettingsApi.addParam({
                    component: PLUGIN_ID,
                    param: { name: STORAGE_KEYS.sortBy, type: 'select', values: { priority: 'По приоритету источников', quality: 'По качеству видео', speed: 'По скорости ответа', name: 'По названию' }, 'default': 'priority' },
                    field: { name: 'Сортировка результатов', description: 'Порядок отображения найденных вариантов' }
                });

                // --- Поиск ---
                Lampa.SettingsApi.addParam({
                    component: PLUGIN_ID,
                    param: { name: STORAGE_KEYS.searchMode, type: 'select', values: { auto: 'Автоматический поиск', manual: 'Ручной поиск', best: 'Лучший выбор' }, 'default': 'auto' },
                    field: { name: 'Режим поиска', description: 'Автоматический запуск при открытии или ручной старт' }
                });
                Lampa.SettingsApi.addParam({
                    component: PLUGIN_ID,
                    param: { name: STORAGE_KEYS.timeoutMs, type: 'select', values: { '3000': '3 сек', '6000': '6 сек', '9000': '9 сек', '12000': '12 сек' }, 'default': '6000' },
                    field: { name: 'Таймаут источника', description: 'Защита от бесконечной загрузки при сбое источника' }
                });
                Lampa.SettingsApi.addParam({ component: PLUGIN_ID, param: { name: STORAGE_KEYS.retryOnError, type: 'trigger', 'default': true }, field: { name: 'Повторный запрос при ошибке', description: 'Одна автоматическая повторная попытка при сетевом сбое' } });
                Lampa.SettingsApi.addParam({ component: PLUGIN_ID, param: { name: STORAGE_KEYS.showProgress, type: 'trigger', 'default': true }, field: { name: 'Отображение процесса поиска', description: 'Показывать статус каждого источника под результатами' } });

                // --- Диагностика ---
                Lampa.SettingsApi.addParam({
                    component: PLUGIN_ID,
                    param: { name: 'andrprod_dd_btn_diag', type: 'button' },
                    field: { name: 'Диагностика ANDRPROD DD', description: 'Версия, статус модулей, ошибки и проверка всех источников' },
                    onChange: function () { HubLauncher.open({ view: 'diagnostics' }); }
                });
            } catch (e) {
                Diagnostics.logError('SettingsIntegration', e);
            }
        }
    };

    // =========================================================================
    // 14. УТИЛИТЫ И СТИЛИ
    // =========================================================================
    function safeTrim(str) { return String(str || '').replace(/^\s+|\s+$/g, ''); }
    function formatTime(ts) {
        try {
            var d = new Date(ts);
            return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
        } catch (e) { return ''; }
    }
    function mapStatusDot(st) {
        if (st === 'found') return 'is-online';
        if (st === 'searching') return 'is-checking';
        if (st === 'error') return 'is-offline';
        if (st === 'unsupported') return 'is-ready';
        return 'is-unknown';
    }
    function makeSafeId(str) {
        return String(str || 'src').toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9а-яё]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 36) || 'src_custom';
    }
    function extractPluginLabel(url) {
        try {
            var clean = String(url).split('?')[0].split('#')[0];
            var parts = clean.split('/');
            var file = (parts[parts.length - 1] || parts[parts.length - 2] || 'Plugin').replace(/\.js$/i, '').replace(/[_-]+/g, ' ');
            return file ? (file.charAt(0).toUpperCase() + file.slice(1)) : 'Плагин';
        } catch (e) { return 'Плагин'; }
    }
    function escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function injectStyles() {
        try {
            if ($('#andrprod-dd-styles').length) return;
            var css = '' +
                '.andrprod-card-btn{background:transparent!important;border:none!important;box-shadow:none!important;min-width:0!important;width:auto!important;height:2.8em!important;padding:0.25em 0.55em!important;display:inline-flex!important;align-items:center;justify-content:center;overflow:visible!important;transition:transform .18s ease,filter .18s ease;}' +
                '.andrprod-card-btn.focus,.andrprod-card-btn:hover{background:transparent!important;box-shadow:none!important;transform:scale(1.07);filter:drop-shadow(0 0 16px rgba(56,189,248,.92));}' +
                '.andrprod-card-btn__logo{height:1.85em!important;width:auto!important;max-width:8.5em!important;display:block;overflow:visible;}' +
                '.andrprod-menu-text{white-space:nowrap!important;overflow:visible!important;}' +
                '.andrprod-hub{padding:1.3em 2em 2em 2em;color:#E2E8F0;}' +
                '.andrprod-hero{display:flex;gap:1.4em;align-items:flex-start;margin-bottom:1.3em;padding:1.1em 1.3em;border-radius:1em;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.07);}' +
                '.andrprod-hero__poster{width:7.2em;height:10.5em;border-radius:0.7em;background-color:rgba(255,255,255,.08);background-size:cover;background-position:center;flex-shrink:0;}' +
                '.andrprod-hero__info{flex:1;min-width:0;}' +
                '.andrprod-hero__logo{height:2.1em;width:auto;display:block;margin-bottom:0.35em;}' +
                '.andrprod-hero__title{font-size:1.35em;font-weight:800;color:#F8FAFC;}' +
                '.andrprod-hero__meta{font-size:0.9em;color:rgba(226,232,240,.72);margin-top:0.25em;}' +
                '.andrprod-hero__status{font-size:0.9em;color:#38BDF8;font-weight:600;margin-top:0.45em;}' +
                '.andrprod-hero__actions{display:flex;flex-wrap:wrap;gap:0.55em;margin-top:0.85em;}' +
                '.andrprod-hub__header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1em;margin-bottom:1.1em;}' +
                '.andrprod-hub__logo{height:2.2em;width:auto;display:block;}' +
                '.andrprod-hub__toolbar{display:flex;align-items:center;gap:0.6em;flex-wrap:wrap;}' +
                '.andrprod-pill{padding:0.55em 1.1em;border-radius:999px;background:rgba(255,255,255,.08);color:#F1F5F9;font-size:0.88em;font-weight:500;transition:background .15s ease,transform .15s ease;}' +
                '.andrprod-pill.focus{background:#0EA5E9;color:#FFFFFF;transform:scale(1.04);box-shadow:0 0 0 2px #7DD3FC;}' +
                '.andrprod-section-title{font-size:1.05em;font-weight:700;color:#7DD3FC;margin:0.9em 0 0.7em 0;}' +
                '.andrprod-source-list{display:flex;flex-direction:column;gap:0.68em;}' +
                '.andrprod-source-card{display:flex;align-items:center;justify-content:space-between;gap:1em;padding:0.95em 1.25em;border-radius:0.9em;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.06);transition:background .15s ease,transform .15s ease,box-shadow .15s ease;}' +
                '.andrprod-source-card.is-disabled{opacity:.5;}' +
                '.andrprod-source-card.focus{background:rgba(14,165,233,.24);transform:scale(1.01);box-shadow:0 0 0 2px #38BDF8;}' +
                '.andrprod-source-card__header{display:flex;align-items:center;gap:0.55em;flex-wrap:wrap;}' +
                '.andrprod-plugin-tag{padding:0.18em 0.6em;border-radius:0.4em;background:rgba(56,189,248,.18);color:#7DD3FC;font-size:0.78em;font-weight:700;}' +
                '.andrprod-source-card__title{font-size:1.02em;font-weight:700;color:#F8FAFC;}' +
                '.andrprod-chips-row{display:flex;flex-wrap:wrap;gap:0.45em;margin-top:0.45em;}' +
                '.andrprod-chip{padding:0.2em 0.55em;border-radius:0.4em;background:rgba(255,255,255,.06);font-size:0.78em;color:rgba(226,232,240,.86);}' +
                '.andrprod-chip .is-yes{color:#4ADE80;}.andrprod-chip .is-unk{color:#94A3B8;}' +
                '.andrprod-source-card__sub{font-size:0.81em;color:rgba(226,232,240,.62);margin-top:0.4em;}' +
                '.andrprod-status-dot{width:0.68em;height:0.68em;border-radius:50%;display:inline-block;flex-shrink:0;}' +
                '.andrprod-status-dot.is-online{background:#22C55E;box-shadow:0 0 8px rgba(34,197,94,.7);}' +
                '.andrprod-status-dot.is-ready{background:#38BDF8;}.andrprod-status-dot.is-offline{background:#EF4444;}.andrprod-status-dot.is-checking{background:#F59E0B;}.andrprod-status-dot.is-unknown{background:#94A3B8;}' +
                '.andrprod-badge{padding:0.3em 0.8em;border-radius:999px;font-size:0.8em;font-weight:700;white-space:nowrap;}' +
                '.andrprod-badge.is-on{background:rgba(34,197,94,.18);color:#4ADE80;}.andrprod-badge.is-off{background:rgba(148,163,184,.2);color:#CBD5E1;}' +
                '.andrprod-settings-list{display:flex;flex-direction:column;gap:0.65em;}' +
                '.andrprod-setting-row{display:flex;align-items:center;justify-content:space-between;padding:0.95em 1.2em;border-radius:0.85em;background:rgba(255,255,255,.05);}' +
                '.andrprod-setting-row__title{font-size:0.98em;font-weight:600;}.andrprod-setting-row__val{font-size:0.9em;font-weight:700;color:#38BDF8;margin-left:1.2em;}' +
                '.andrprod-empty{padding:2em 1.5em;text-align:center;background:rgba(255,255,255,.04);border-radius:0.9em;}' +
                '.andrprod-empty__title{font-size:1.08em;font-weight:600;margin-bottom:0.4em;}.andrprod-empty__desc{font-size:0.88em;color:rgba(226,232,240,.68);max-width:44em;margin:0 auto;}';
            $('head').append('<style id="andrprod-dd-styles">' + css + '</style>');
        } catch (e) {
            Diagnostics.logError('injectStyles', e);
        }
    }

    // =========================================================================
    // 15. ПУБЛИЧНЫЙ API (window.ANDRPROD_API)
    // =========================================================================
    window.ANDRPROD_API = {
        version: PLUGIN_VERSION,
        registerAdapter: function (adapter) { return SourceRegistry.registerAdapter(adapter); },
        getAdapters: function () { return SourceRegistry.getAdapters(); },
        search: function (card, method, scope, force, callbacks) { return UnifiedSearchEngine.search(card, method, scope, force, callbacks); },
        cancelSearch: function () { return UnifiedSearchEngine.cancelActiveSearch(); },
        filterResults: function (list) { return FilterEngine.apply(list); },
        checkAllSources: function (onEach, onDone) { return UnifiedSearchEngine.checkAllSources(onEach, onDone); },
        getDiagnostics: function () { return Diagnostics.getReport(); },
        storage: StorageManager
    };

    // =========================================================================
    // 16. БЕЗОПАСНАЯ ИНИЦИАЛИЗАЦИЯ БЕЗ ЗАВИСИМОСТИ ОТ РАННЕГО jQuery
    // =========================================================================
    function registerManifest() {
        try {
            if (!Lampa.Manifest) return;
            Lampa.Manifest.plugins = {
                type: 'video',
                version: PLUGIN_VERSION,
                name: PLUGIN_NAME,
                description: 'Единый агрегатор онлайн-источников Lampa',
                component: HUB_COMPONENT
            };
            Diagnostics.manifestRegistered = true;
        } catch (e) {
            Diagnostics.logError('registerManifest', e);
        }
    }

    function startPlugin() {
        if (window.andrprod_dd_ready) return;
        if (!window.Lampa || !window.$) {
            Diagnostics.logError('Boot', 'Lampa или jQuery ещё не готовы');
            return;
        }

        registerManifest();
        injectStyles();

        try {
            if (Lampa.Component && typeof Lampa.Component.add === 'function') {
                if (!Diagnostics.componentsRegistered.hub) {
                    Lampa.Component.add(HUB_COMPONENT, AndrprodHubComponent);
                    Diagnostics.componentsRegistered.hub = true;
                }
                if (!Diagnostics.componentsRegistered.search) {
                    Lampa.Component.add(SEARCH_COMPONENT, AndrprodSearchComponent);
                    Diagnostics.componentsRegistered.search = true;
                }
            }
        } catch (eComp) { Diagnostics.logError('Boot.Component', eComp); }

        try { SourceRegistry.resetAndScan(); } catch (eScan) { Diagnostics.logError('Boot.Scan', eScan); }
        try { CardIntegration.init(); } catch (eCard) { Diagnostics.logError('Boot.Card', eCard); }
        try { SettingsIntegration.init(); } catch (eSet) { Diagnostics.logError('Boot.Settings', eSet); }

        if (Diagnostics.componentsRegistered.hub && Diagnostics.componentsRegistered.search) {
            Diagnostics.loaded = true;
            Diagnostics.initialized = true;
            window.andrprod_dd_ready = true;
        }
    }

    function bootstrap() {
        if (!window.Lampa || !window.$) {
            var attempts = 0;
            var timer = setInterval(function () {
                attempts++;
                if (window.Lampa && window.$) {
                    clearInterval(timer);
                    bootstrap();
                } else if (attempts >= 40) {
                    clearInterval(timer);
                    Diagnostics.logError('Bootstrap', 'Lampa/jQuery не обнаружены после ожидания');
                }
            }, 250);
            return;
        }

        if (window.appready) {
            startPlugin();
        } else if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
            Lampa.Listener.follow('app', function (e) {
                if (e && e.type === 'ready') startPlugin();
            });
        } else {
            startPlugin();
        }
    }

    bootstrap();
})();