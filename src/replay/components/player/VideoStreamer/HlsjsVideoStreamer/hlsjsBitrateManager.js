// @flow
import type { InitialPlaybackProps, VideoStreamState } from '../types';
import { isShallowEqual } from '../../../common';
import type { HlsjsQualityLevel } from 'hls.js';
import Hls from 'hls.js';

declare class Object {
  static entries<TKey, TValue>({ [key: TKey]: TValue }): [TKey, TValue][];
}

type PropsWithInitial = {
  initialPlaybackProps?: InitialPlaybackProps
};

/*function getBitrateAsBps(track) {
  return (track && track.bandwidth) || 0;
}

function numericSort(a, b) {
  return a - b;
}

function bandwidthSort(a: HlsjsQualityLevel, b: HlsjsQualityLevel) {
  return a.bitrate - b.bitrate;
}*/

function getBitrateAsKbps(level: HlsjsQualityLevel) {
  return (level && Math.ceil(level.bitrate / 1000)) || 0;
}

const getHlsjsBitrateManager = <P: PropsWithInitial>(
  streamer: { props: P },
  hls: Hls,
  updateStreamState: VideoStreamState => void,
  log?: ?(string, any) => void
) => {
  let previousBitrates = [];

  function updateBitrateProps() {
    let bitrates = Array.isArray(hls.levels) ? hls.levels.map(getBitrateAsKbps) : [];
    if (isShallowEqual(previousBitrates, bitrates)) {
      bitrates = previousBitrates;
    }
    if (hls.currentLevel === -1) {
      updateStreamState({
        bitrates
      });
    } else {
      const currentBitrate = getBitrateAsKbps(hls.levels[hls.currentLevel]);
      updateStreamState({
        currentBitrate,
        bitrates
      });
    }
  }

  function capBitrate(cap: ?number) {
    if (isNaN(cap) || cap === Infinity || cap == null || cap < 0) {
      log && log('Resetting restrictions for bitrate.');
      hls.autoLevelCapping = -1;
      updateStreamState({ maxBitrate: null });
    } else {
      if (Array.isArray(hls.levels)) {
        let reached = false;
        for (let i = 0; i < hls.levels.length; i++) {
          const bitrate = getBitrateAsKbps(hls.levels[i]);
          if (bitrate > cap + 1) {
            hls.autoLevelEnabled = true;
            if (i > 0) {
              hls.autoLevelCapping = i - 1;
              log &&
                log(
                  'Desired bitrate cap corresponds to level with capping on index ' + (i - 1) + ' in hls.js.',
                  hls.levels
                );
            } else {
              hls.autoLevelCapping = 0;
              log &&
                log(
                  'Desired bitrate cap appears to be lower than the lowest HLS level. Aligning to lowest level.',
                  hls.levels
                );
            }
            reached = true;
            updateStreamState({ maxBitrate: bitrate });
            break;
          }
        }
        if (!reached) {
          log && log('Desired bitrate cap appears to be higher than the higher HLS level. Not applicable.', hls.levels);
        }
      } else {
        log && log('Found no HLS levels from where bitrate capping can be applied.', hls.levels);
      }
    }
  }

  function lockBitrate(bitrate: ?(number | 'max' | 'min')) {
    if (bitrate === 'min') {
      if (Array.isArray(hls.levels) && hls.levels.length > 0) {
        hls.nextLevel = 0;
        hls.autoLevelEnabled = false;
        updateStreamState({ lockedBitrate: getBitrateAsKbps(hls.levels[0]) });
        log && log('Locking bitrate to lowest level out of ' + hls.levels.length);
      }
    } else if (bitrate === 'max') {
      if (Array.isArray(hls.levels) && hls.levels.length > 0) {
        hls.nextLevel = hls.levels.length - 1;
        hls.autoLevelEnabled = false;
        updateStreamState({ lockedBitrate: getBitrateAsKbps(hls.levels[hls.levels.length - 1]) });
        log && log('Locking bitrate to highest level out of ' + hls.levels.length);
      }
    } else if (bitrate == null || isNaN(bitrate) || bitrate < 0 || !bitrate) {
      log && log('Resetting locking of bitrate.');
      hls.nextLevel = -1;
      hls.autoLevelEnabled = true;
      updateStreamState({ lockedBitrate: null });
    } else if (typeof bitrate === 'string') {
      log &&
        log(
          'Unknown string specified for bitrate lock. Please use a value of type number if a bitrate specified by kbps is intended.',
          bitrate
        );
    } else {
      if (Array.isArray(hls.levels)) {
        for (var i = 0; i < hls.levels.length; i++) {
          if (getBitrateAsKbps(hls.levels[i]) === bitrate) {
            hls.nextLevel = i;
            log && log('Locking bitrate to HLS level ' + i, hls.levels);
            updateStreamState({ lockedBitrate: bitrate });
            return;
          }
        }
        log &&
          log(
            "Desired bitrate lock didn't match any bitrates specified in the hls.levels list. Not applied.",
            hls.levels
          );
      } else {
        log && log('Found no HLS levels from where bitrate locking can be applied.', hls.levels);
      }
    }
  }

  const hlsjsEventHandlers = {
    [Hls.Events.MANIFEST_LOADING]: () => {
      previousBitrates = [];
    },
    [Hls.Events.MANIFEST_PARSED]: updateBitrateProps,
    [Hls.Events.LEVEL_SWITCHED]: updateBitrateProps,
    [Hls.Events.LEVEL_UPDATED]: updateBitrateProps,
    [Hls.Events.DESTROYING]: cleanup
  };

  function cleanup() {
    Object.entries(hlsjsEventHandlers).forEach(([name, handler]) => {
      hls.off(name, handler);
    });
  }

  Object.entries(hlsjsEventHandlers).forEach(([name, handler]) => {
    hls.on(name, handler);
  });

  return {
    cleanup,
    lockBitrate,
    capBitrate
  };
};

export default getHlsjsBitrateManager;