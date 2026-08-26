// VERBATIM PORT from earthscape web repo (frontend/src/js/timeline/mergeGraphData.js).
// Do not edit — see CLAUDE.md rule 5. graphs = {category: {name: [[utc, value], ...]}}.
export function mergeGraphData(a, b) {
    const result = {}

    Object.keys(a || {}).forEach(category => {
        if (!result[category]) {
            result[category] = {}
        }

        Object.keys(a[category]).forEach(name => {
            result[category][name] =
                b && b[category] && b[category][name]
                    ? a[category][name].concat(b[category][name])
                    : a[category][name]
        })
    })

    Object.keys(b || {}).forEach(category => {
        if (!result[category]) {
            result[category] = {}
        }

        Object.keys(b[category]).forEach(name => {
            if (!result[category][name]) {
                result[category][name] = b[category][name]
            }
        })
    })

    return result
}
