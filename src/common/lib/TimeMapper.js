// VERBATIM PORT from earthscape web repo (frontend .../TimeMapper.js).
// Do not edit — see CLAUDE.md rule 5. All video<->UTC conversion goes through this.

export function isVideoTimeInTimeMapEntry(timeMapEntry, videoTime) {
  return (
    timeMapEntry.videoStart <= videoTime &&
    timeMapEntry.videoEnd >= videoTime
  );
}

export function isUtcTimeInTimeMapEntry(timeMapEntry, utcTime) {
  return timeMapEntry.utcStart <= utcTime && timeMapEntry.utcEnd >= utcTime;
}

export function validateVideoTimeUtcTimeMap(videoTimeUtcTimeMap) {
  if (!Array.isArray(videoTimeUtcTimeMap) || videoTimeUtcTimeMap.length < 1) {
    return false;
  }

  let previousVideoStart = null;
  let previousUtcStart = null;
  for (const mapEntry of videoTimeUtcTimeMap) {
    if (previousVideoStart !== null && previousVideoStart >= mapEntry.videoStart) {
      throw new Error(`TimeMapper: videoTimeUtcTimeMap not sorted. previousVideoStart >= videoStart`);
    }
    if (previousUtcStart !== null && previousUtcStart >= mapEntry.utcStart) {
      throw new Error(`TimeMapper: videoTimeUtcTimeMap not sorted. previousUtcStart >= utcStart`);
    }
    previousVideoStart = mapEntry.videoStart;
    previousUtcStart = mapEntry.utcStart;
  }

  for (const mapEntry of videoTimeUtcTimeMap) {
    if (mapEntry.videoStart > mapEntry.videoEnd) {
      throw new Error(`TimeMapper: videoStart > videoEnd`);
    }
    if (mapEntry.utcStart > mapEntry.utcEnd) {
      throw new Error(`TimeMapper: utcStart > utcEnd`);
    }
  }

  let previousVideoEnd = null;
  for (const mapEntry of videoTimeUtcTimeMap) {
    if (previousVideoEnd !== null && mapEntry.videoStart > previousVideoEnd) {
      throw new Error(`TimeMapper: There is a gap in video time. videoStart > previousVideoEnd`);
    }
    previousVideoEnd = mapEntry.videoEnd;
  }

  previousVideoEnd = null;
  for (const mapEntry of videoTimeUtcTimeMap) {
    if (previousVideoEnd !== null && mapEntry.videoStart < previousVideoEnd) {
      throw new Error(`TimeMapper: There is some overlap in video time. videoStart < previousVideoEnd`);
    }
    previousVideoEnd = mapEntry.videoEnd;
  }

  let previousUtcEnd = null;
  for (const mapEntry of videoTimeUtcTimeMap) {
    if (previousUtcEnd !== null && mapEntry.utcStart < previousUtcEnd) {
      throw new Error(`TimeMapper: There is some overlap in UTC time. utcStart < previousUtcEnd`);
    }
    previousUtcEnd = mapEntry.utcEnd;
  }

  for (const mapEntry of videoTimeUtcTimeMap) {
    if (Math.abs(mapEntry.videoEnd - mapEntry.videoStart - (mapEntry.utcEnd - mapEntry.utcStart)) > 0.01) {
      throw new Error(`TimeMapper: UTC and video time durations not equal`);
    }
  }

  return true;
}

export function createTimeMapper(startUtc, videoTimeUtcTimeMap) {
  const validatedVideoTimeUtcTimeMap = validateVideoTimeUtcTimeMap(videoTimeUtcTimeMap)
    ? videoTimeUtcTimeMap
    : null;
  let lastFoundInterval = null;

  function findIntervalByUtcTime(utcTime) {
    if (lastFoundInterval && isUtcTimeInTimeMapEntry(lastFoundInterval, utcTime)) {
      return lastFoundInterval;
    }

    let selectedInterval = validatedVideoTimeUtcTimeMap.find(timeMapEntry =>
      isUtcTimeInTimeMapEntry(timeMapEntry, utcTime)
    );
    if (!selectedInterval) {
      if (validatedVideoTimeUtcTimeMap[0].utcStart > utcTime) {
        selectedInterval = validatedVideoTimeUtcTimeMap[0];
      } else if (validatedVideoTimeUtcTimeMap[validatedVideoTimeUtcTimeMap.length - 1].utcEnd < utcTime) {
        selectedInterval = validatedVideoTimeUtcTimeMap[validatedVideoTimeUtcTimeMap.length - 1];
      } else {
        selectedInterval = null;
      }
    }
    lastFoundInterval = selectedInterval;

    return selectedInterval;
  }

  const findIntervalByVideoTime = (videoTime) => {
    if (lastFoundInterval && isVideoTimeInTimeMapEntry(lastFoundInterval, videoTime)) {
      return lastFoundInterval;
    }

    let selectedInterval = validatedVideoTimeUtcTimeMap.find(timeMapEntry =>
      isVideoTimeInTimeMapEntry(timeMapEntry, videoTime)
    );
    if (!selectedInterval) {
      if (validatedVideoTimeUtcTimeMap[0].videoStart > videoTime) {
        selectedInterval = validatedVideoTimeUtcTimeMap[0];
      } else if (validatedVideoTimeUtcTimeMap[validatedVideoTimeUtcTimeMap.length - 1].videoEnd < videoTime) {
        selectedInterval = validatedVideoTimeUtcTimeMap[validatedVideoTimeUtcTimeMap.length - 1];
      } else {
        selectedInterval = null;
      }
    }
    lastFoundInterval = selectedInterval;
    return selectedInterval;
  }

  function videoToUtc(videoTime) {
    videoTime = Number(videoTime)
    if (!Number.isFinite(videoTime)) {
      return null;
    }

    if (validatedVideoTimeUtcTimeMap) {
      const mapEntry = findIntervalByVideoTime(videoTime);
      return mapEntry ? videoTime - mapEntry.videoStart + mapEntry.utcStart : null;
    }

    return videoTime + startUtc;
  }

  function utcToVideo(utcTime) {

    if (!Number.isFinite(utcTime)) {
      return null;
    }
    if (validatedVideoTimeUtcTimeMap) {
      const mapEntry = findIntervalByUtcTime(utcTime);
      if (!mapEntry) {
        const firstMapEntryAfterGap = validatedVideoTimeUtcTimeMap.find(me => me.utcStart >= utcTime);
        if (firstMapEntryAfterGap) {
          return firstMapEntryAfterGap.videoStart;
        }
      }

      return mapEntry ? utcTime - mapEntry.utcStart + mapEntry.videoStart : null;
    }
    return utcTime - startUtc;
  }

  return {
    startUtc: Number.isFinite(startUtc) ? startUtc : 0.0,
    videoTimeUtcTimeMap: validatedVideoTimeUtcTimeMap,
    videoToUtc,
    utcToVideo,
  };
}
