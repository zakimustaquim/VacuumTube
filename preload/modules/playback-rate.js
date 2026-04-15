const configManager = require('../config')
const functions = require('../util/functions')
const css = require('../util/css')
const localeProvider = require('../util/localeProvider')
const rcMod = require('../util/resolveCommandModifiers')
const xhrModifiers = require('../util/xhrModifiers')

const config = configManager.get()

const minPlaybackRate = 0.25
const maxPlaybackRate = 4
const playbackRateSteps = [
    0.25, 0.5, 0.75, 1,
    1.25, 1.5, 1.75, 2,
    2.25, 2.5, 2.75, 3,
    3.5, 4
]
const videoSelector = '.html5-main-video'
const playbackRateButtonTypes = [
    'TRANSPORT_CONTROLS_BUTTON_TYPE_VT_PLAYBACK_RATE_DECREASE',
    'TRANSPORT_CONTROLS_BUTTON_TYPE_VT_PLAYBACK_RATE_INCREASE'
]

module.exports = async () => {
    await localeProvider.waitUntilAvailable()

    const locale = localeProvider.getLocale()
    let activeVideo = null
    let enforcingRate = false
    let playbackRateOverlay = null
    let playbackRateOverlayHideTimeout = null

    css.inject('playback-rate', `
        #vt-playback-rate-overlay {
            position: fixed;
            top: 32px;
            right: 32px;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            gap: 14px;
            min-width: 210px;
            padding: 14px 18px;
            border-radius: 18px;
            background: rgba(24, 24, 24, 0.92);
            color: #fff;
            pointer-events: none;
            box-shadow: 0 18px 42px rgba(0, 0, 0, 0.35);
            opacity: 0;
            transform: translateY(-8px) scale(0.98);
            transition: opacity 140ms ease, transform 140ms ease;
            font-family: system-ui, sans-serif;
        }

        #vt-playback-rate-overlay.vt-visible {
            opacity: 1;
            transform: translateY(0) scale(1);
        }

        .vt-playback-rate-badge {
            flex: 0 0 auto;
            min-width: 58px;
            padding: 6px 10px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.14);
            font-size: 24px;
            font-weight: 700;
            line-height: 1;
            text-align: center;
        }

        .vt-playback-rate-copy {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
        }

        .vt-playback-rate-title {
            font-size: 16px;
            font-weight: 600;
            line-height: 1.2;
            opacity: 0.96;
        }

        .vt-playback-rate-subtitle {
            font-size: 14px;
            line-height: 1.2;
            opacity: 0.72;
        }
    `)

    function clampPlaybackRate(rate) {
        return Math.min(maxPlaybackRate, Math.max(minPlaybackRate, rate))
    }

    function normalizePlaybackRate(rate) {
        if (!Number.isFinite(rate)) return 1

        const clamped = clampPlaybackRate(rate)
        return Math.round(clamped * 100) / 100
    }

    function formatPlaybackRate(rate) {
        return Number.isInteger(rate) ? String(rate) : rate.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    }

    function getDesiredPlaybackRate() {
        return normalizePlaybackRate(config.playback_rate)
    }

    function setDesiredPlaybackRate(rate) {
        const normalized = normalizePlaybackRate(rate)
        configManager.set({ playback_rate: normalized })
        return normalized
    }

    function showPlaybackRateToast(rate) {
        const overlay = ensurePlaybackRateOverlay()
        overlay.querySelector('.vt-playback-rate-badge').textContent = `${formatPlaybackRate(rate)}x`
        overlay.querySelector('.vt-playback-rate-title').textContent = locale.general.playback_rate
        overlay.querySelector('.vt-playback-rate-subtitle').textContent = 'VacuumTube'
        overlay.classList.add('vt-visible')

        clearTimeout(playbackRateOverlayHideTimeout)
        playbackRateOverlayHideTimeout = setTimeout(() => {
            overlay.classList.remove('vt-visible')
            playbackRateOverlayHideTimeout = null
        }, 1100)
    }

    function ensurePlaybackRateOverlay() {
        if (playbackRateOverlay?.isConnected) return playbackRateOverlay

        playbackRateOverlay = functions.el('div', {
            id: 'vt-playback-rate-overlay',
            ariaHidden: 'true'
        }, [
            functions.el('div', {
                className: 'vt-playback-rate-badge',
                textContent: `${formatPlaybackRate(getDesiredPlaybackRate())}x`
            }),
            functions.el('div', { className: 'vt-playback-rate-copy' }, [
                functions.el('div', {
                    className: 'vt-playback-rate-title',
                    textContent: locale.general.playback_rate
                }),
                functions.el('div', {
                    className: 'vt-playback-rate-subtitle',
                    textContent: 'VacuumTube'
                })
            ])
        ])

        document.body.appendChild(playbackRateOverlay)
        return playbackRateOverlay
    }

    function createPlaybackRateEndpoint(action) {
        return {
            vtPlaybackRateAction: action
        }
    }

    function createPlaybackRateButton(templateAction, iconType, action, accessibilityLabel) {
        const templateRenderer = templateAction?.button?.buttonRenderer
        if (!templateRenderer) return null

        const buttonRenderer = JSON.parse(JSON.stringify(templateRenderer))
        delete buttonRenderer.text
        delete buttonRenderer.secondaryText

        buttonRenderer.icon = {
            iconType
        }
        buttonRenderer.title = {
            simpleText: accessibilityLabel
        }
        buttonRenderer.accessibility = {
            accessibilityData: {
                label: accessibilityLabel
            }
        }
        buttonRenderer.command = createPlaybackRateEndpoint(action)
        buttonRenderer.navigationEndpoint = createPlaybackRateEndpoint(action)

        return {
            type: `TRANSPORT_CONTROLS_BUTTON_TYPE_VT_PLAYBACK_RATE_${action.toUpperCase()}`,
            button: {
                buttonRenderer
            }
        }
    }

    function applyPlaybackRate(video = activeVideo) {
        const desiredRate = getDesiredPlaybackRate()
        if (!video || Math.abs(video.playbackRate - desiredRate) < 0.01) return

        enforcingRate = true
        video.playbackRate = desiredRate

        setTimeout(() => {
            enforcingRate = false
        }, 0)
    }

    function findNextPlaybackRate(direction) {
        const desiredRate = getDesiredPlaybackRate()
        if (direction > 0) {
            return playbackRateSteps.find((step) => step > desiredRate + 0.001) || maxPlaybackRate
        }

        const lowerRates = playbackRateSteps.filter((step) => step < desiredRate - 0.001)
        return lowerRates[lowerRates.length - 1] || minPlaybackRate
    }

    function updatePlaybackRate(rate, showToast = true) {
        const normalized = setDesiredPlaybackRate(rate)
        applyPlaybackRate()

        if (showToast) {
            showPlaybackRateToast(normalized)
        }
    }

    function onPlaybackRateChanged() {
        if (!activeVideo || enforcingRate) return

        const actualRate = normalizePlaybackRate(activeVideo.playbackRate)
        if (Math.abs(actualRate - getDesiredPlaybackRate()) < 0.01) return

        setDesiredPlaybackRate(actualRate)
    }

    function decreasePlaybackRate() {
        updatePlaybackRate(findNextPlaybackRate(-1))
    }

    function increasePlaybackRate() {
        updatePlaybackRate(findNextPlaybackRate(1))
    }

    function resetPlaybackRate() {
        updatePlaybackRate(1)
    }

    function attachToVideo(video) {
        if (activeVideo === video) return

        if (activeVideo) {
            activeVideo.removeEventListener('ratechange', onPlaybackRateChanged)
            activeVideo.removeEventListener('loadedmetadata', applyPlaybackRate)
            activeVideo.removeEventListener('playing', applyPlaybackRate)
        }

        activeVideo = video
        if (!activeVideo) return

        activeVideo.addEventListener('ratechange', onPlaybackRateChanged)
        activeVideo.addEventListener('loadedmetadata', applyPlaybackRate)
        activeVideo.addEventListener('playing', applyPlaybackRate)

        applyPlaybackRate(activeVideo)
    }

    await functions.waitForSelector(videoSelector)
    attachToVideo(document.querySelector(videoSelector))
    await functions.waitForCondition(() => !!document.body)
    ensurePlaybackRateOverlay()

    window.vtPlaybackRate = {
        get: getDesiredPlaybackRate,
        set: updatePlaybackRate,
        reset: resetPlaybackRate,
        increase: increasePlaybackRate,
        decrease: decreasePlaybackRate
    }

    rcMod.addInputModifier((command) => {
        if (!command?.vtPlaybackRateAction) return command

        if (command.vtPlaybackRateAction === 'decrease') {
            decreasePlaybackRate()
        } else if (command.vtPlaybackRateAction === 'increase') {
            increasePlaybackRate()
        } else if (command.vtPlaybackRateAction === 'reset') {
            resetPlaybackRate()
        }

        return false;
    })

    xhrModifiers.addResponseModifier(async (url, text) => {
        if (!url.startsWith('/youtubei/v1/next')) return;

        const json = JSON.parse(text)
        const engagementActions = json.transportControls?.transportControlsRenderer?.engagementActions
        if (!Array.isArray(engagementActions)) return;

        if (engagementActions.some((action) => playbackRateButtonTypes.includes(action?.type))) {
            return;
        }

        const templateAction = engagementActions.find((action) => action?.button?.buttonRenderer)
        if (!templateAction) return;

        const decreaseButton = createPlaybackRateButton(templateAction, 'REMOVE', 'decrease', locale.general.playback_rate_decrease)
        const increaseButton = createPlaybackRateButton(templateAction, 'ADD', 'increase', locale.general.playback_rate_increase)
        if (!decreaseButton || !increaseButton) return;

        const insertionIndex = Math.min(engagementActions.length, 3)
        engagementActions.splice(insertionIndex, 0, decreaseButton, increaseButton)

        return JSON.stringify(json);
    })

    const observer = new MutationObserver(() => {
        attachToVideo(document.querySelector(videoSelector))
    })

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    })

    window.addEventListener('hashchange', () => {
        setTimeout(() => {
            attachToVideo(document.querySelector(videoSelector))
            applyPlaybackRate()
        }, 250)
    })

    document.addEventListener('keydown', (e) => {
        if (!e.key) return

        if (e.ctrlKey || e.altKey || e.metaKey) return

        if (e.key === '[' || e.key === '{' || e.key === '<') {
            e.preventDefault()
            e.stopPropagation()
            e.stopImmediatePropagation()
            decreasePlaybackRate()
        } else if (e.key === ']' || e.key === '}' || e.key === '>') {
            e.preventDefault()
            e.stopPropagation()
            e.stopImmediatePropagation()
            increasePlaybackRate()
        } else if (e.key === '\\' || e.key === '|') {
            e.preventDefault()
            e.stopPropagation()
            e.stopImmediatePropagation()
            resetPlaybackRate()
        }
    }, true)
}
