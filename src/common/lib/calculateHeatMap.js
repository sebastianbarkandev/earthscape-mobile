// VERBATIM PORT from earthscape web repo (frontend/src/js/timeline/calculateHeatMap.js).
// Do not edit — see CLAUDE.md rule 5. target series -> [lat, lon, intensity] heat points.


export function calculateHeatMap(data) {
    const totalTimePerPointMap = new Map();

    for (let i = 0; i < data.length - 1; i++) {
        const currentItem = data[i];
        const nextItem = data[i + 1];

        // Calculate time difference between the current item and the next
        const timeDifference = nextItem[0] - currentItem[0];

        // Prepare a unique key for the current lat/lng point
        const lat = currentItem[1][0].toFixed(5);
        const lng = currentItem[1][1].toFixed(5);
        const key = `${lat},${lng}`;

        // Check if this lat/lng point already has a recorded time
        if (totalTimePerPointMap.has(key)) {
            totalTimePerPointMap.get(key).totalTime += timeDifference;
        } else {
            totalTimePerPointMap.set(key, {
                lat,
                lng,
                totalTime: timeDifference
            });
        }
    }

    // Convert the totalTimePerPointMap to an array of objects
    return Array.from(totalTimePerPointMap.values()).map(e => ([
        e.lat,
        e.lng,
        e.totalTime
    ]));
}
