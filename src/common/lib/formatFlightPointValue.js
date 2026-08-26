// VERBATIM PORT from earthscape web repo (frontend/src/js/timeline/formatFlightPointValue.js).
// Do not edit — see CLAUDE.md rule 5. Formats a flight-point value per its bootstrap field meta.
import { filesize } from 'filesize'
import memoize from 'lodash/memoize'

/**
 * @typedef {{sources: string[][], formatting_function: string|null, unit: string|null, number_format: string|null}} FlightPointFieldMeta
 */

const byteUnits = [' b/s', ' kb/s', ' Mb/s', ' Gb/s']
const validValueRangeForMbps = { min: 0, max: 100000 } // 100GBps = 100,000 Mbps

const formattingFunctions = {
    format_mbps: valueInMbps => {
        let valueInBitsPerSecond = valueInMbps * 1000000
        if (
            !Number.isFinite(valueInBitsPerSecond) ||
            valueInBitsPerSecond > validValueRangeForMbps.max * 1000000 ||
            valueInBitsPerSecond < validValueRangeForMbps.min * 1000000
        ) {
            return '∞'
        }

        let i = 0
        while (
            Math.abs(valueInBitsPerSecond) >= 1000 &&
            i < byteUnits.length - 1
        ) {
            // eslint-disable-next-line no-param-reassign
            valueInBitsPerSecond /= 1000
            i += 1
        }
        return valueInBitsPerSecond.toFixed(2) + byteUnits[i]
    },
    format_bytes: valueInBytes => {
        return filesize(valueInBytes, { base: 10, locale: 'en-US', round: 3 })
    }
}

const unitToSymbol = {
    percent: '%'
}

const getNumberFormatObject = memoize(numberFormat => {
    if (!numberFormat) {
        return new Intl.NumberFormat('en-US')
    }

    if (
        numberFormat.minimumSignificantDigits !== undefined ||
        numberFormat.maximumSignificantDigits !== undefined
    ) {
        return new Intl.NumberFormat('en-US', {
            minimumSignificantDigits: numberFormat.minimumSignificantDigits,
            maximumSignificantDigits: numberFormat.maximumSignificantDigits,
            useGrouping: !!numberFormat.useGrouping
        })
    }
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: numberFormat.minimumFractionDigits,
        maximumFractionDigits: numberFormat.maximumFractionDigits,
        useGrouping: !!numberFormat.useGrouping
    })
})

/**
 * Format the value according to number_format, formatting_function and unit defined in field
 *
 * @param {FlightPointFieldMeta} field
 * @param {number} value
 * @returns {string}
 */
export function formatFlightPointValue(field, value) {
    value = Number(value) // eslint-disable-line no-param-reassign
    if (!Number.isFinite(value)) {
        return 'N/A'
    }

    if (
        field.formatting_function &&
        formattingFunctions[field.formatting_function]
    ) {
        return formattingFunctions[field.formatting_function](value)
    }
    if (field.unit && field.unit.toLowerCase() === 'bytes') {
        return formattingFunctions.format_bytes(value)
    }
    if (field.unit && field.unit.toLowerCase() === 'mbps') {
        return formattingFunctions.format_mbps(value)
    }

    const result = getNumberFormatObject(field.number_format).format(value)

    const unit =
        field.unit && unitToSymbol[field.unit.toLowerCase()]
            ? unitToSymbol[field.unit.toLowerCase()]
            : field.unit
    return unit ? `${result} ${unit}` : result
}
