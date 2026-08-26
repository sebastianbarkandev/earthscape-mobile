const { formatFlightPointValue } = require('../formatFlightPointValue')

describe('formatFlightPointValue', () => {
    it('can format percentages', () => {
        let field = {
            unit: 'percent'
        }
        expect(formatFlightPointValue(field, 123.456)).toEqual('123.456 %')

        field = {
            unit: 'percent',
            number_format: {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }
        }
        expect(formatFlightPointValue(field, 123.456)).toEqual('123.46 %')
    })

    it('can format Mbps', () => {
        let field = {
            formatting_function: 'format_mbps'
        }
        expect(formatFlightPointValue(field, 12)).toEqual('12.00 Mb/s')

        field = {
            unit: 'Mbps'
        }
        expect(formatFlightPointValue(field, 12)).toEqual('12.00 Mb/s')
    })

    it('returns N/A for invalid values', () => {
        expect(formatFlightPointValue({}, Number('Whatever'))).toBe('N/A')
        expect(formatFlightPointValue({}, Number.POSITIVE_INFINITY)).toBe('N/A')
        expect(formatFlightPointValue({}, Number.NEGATIVE_INFINITY)).toBe('N/A')
    })
})
