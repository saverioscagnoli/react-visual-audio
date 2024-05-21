import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createAnimationHandlers,
  loadAndEmitAudioSource,
  startAudioSource
} from "./scripts";
import { AudioState, AudioVisualizerProps } from "./types";

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  src,
  autoStart = true,
  audioState: audioStateProp,
  onAudioStateChange: onAudioStateChangeProp,
  stagger = 1,
  barWidth = (w, l) => w / l,
  barHeight = h => h,
  barColor = "green",
  spaceBetweenBars = 1,
  fftSize = 2048,
  customDrawFunction = (ctx, { x, canvasHeight, barWidth, barHeight }) => {
    ctx.fillRect(x, canvasHeight - barHeight, barWidth, barHeight);
  },
  onSourceLoaded: onSourceLoadedProp,
  onSourceStarted,
  onSourceEnded,
  ...props
}) => {
  /**
   * Create an audio context and an analyser node
   */
  const [audioContext, analyser] = useMemo(() => {
    const audioContext = new AudioContext();

    const analyser = audioContext.createAnalyser();

    analyser.fftSize = fftSize;

    return [audioContext, analyser];
  }, [fftSize]);

  /**
   * The states are necessary to the component to work properly,
   * but they don't need to be controlled. So, we use an internal state if not provided
   */
  const [internalState, setInternalState] = useState<AudioState>("unset");

  const audioState = audioStateProp ?? internalState;
  const onAudioStateChange = onAudioStateChangeProp ?? setInternalState;

  /**
   * Keep track of the previous state to handle the audio state changes
   */
  const prevState = useRef<AudioState>("unset");

  /**
   * Create a ref to the canvas element and the audio source node
   */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  /**
   * Create a ref to the start and stop functions of the animation
   * To be used with the createAnimationHandlers function, which returns them
   */
  const startRef = useRef<(() => void) | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  /**
   * Create a nice handle so we don't need to call
   * startRef.current?.() and stopRef.current?.() every time
   */
  const [startAnimation, stopAnimation] = useMemo(
    () => [startRef.current!, stopRef.current!],
    [startRef.current, stopRef.current]
  );

  /**
   * This function is called when the audio source is loaded.
   * Sets the state to pending, so the audio state management useEffect can handle it.
   */
  const onSourceLoaded = useCallback(() => {
    onSourceLoadedProp?.(sourceRef.current!);
    onAudioStateChange("pending");
  }, [onSourceLoadedProp, onAudioStateChange]);

  /**
   * See when the analyser node is created, and set the start and stop functions
   */
  useEffect(() => {
    if (!canvasRef.current) return;

    const [stop, start] = createAnimationHandlers(
      analyser,
      canvasRef.current.getContext("2d")!,
      stagger,
      barWidth,
      barHeight,
      barColor,
      customDrawFunction
    );

    startRef.current = start;
    stopRef.current = stop;
  }, [analyser, stagger]);

  /**
   * When the src string changes, if there was a previous source, stop it prematurely,
   * without invoking the onSourceEnded callback.
   *
   * Load the new source and set the sourceRef.current to the new source.
   */
  useEffect(() => {
    if (sourceRef.current && prevState.current !== "pending") {
      sourceRef.current.onended = null;
      sourceRef.current.stop();
      stopAnimation();
    }

    /**
     * Reset the source to avoid problems with the previous source
     */
    sourceRef.current = null;

    loadAndEmitAudioSource(
      src,
      audioContext,
      analyser,
      sourceRef,
      onSourceEnded,
      onAudioStateChange,
      onSourceLoaded
    );
  }, [src]);

  /**
   * Audio state management
   */
  useEffect(() => {
    switch (audioState) {
      /**
       * If the audio state is pending, and the autoStart is true, start the audio source
       */
      case "pending": {
        if (autoStart) {
          startAudioSource(sourceRef.current!, startAnimation);
          onSourceStarted?.();
          onAudioStateChange("playing");
        }

        break;
      }

      case "playing": {
        /**
         * If the previous state was pending, and autoStart is false, means that
         * the user changed the state manually, so we have to start the audio source
         */
        if (prevState.current === "pending" && !autoStart) {
          startAudioSource(sourceRef.current!, startAnimation);
          onSourceStarted?.();

          /**
           * If the previous state was ended, it means that
           * the user wants to restart the audio source,
           * so we have to reload it.
           */
        } else if (prevState.current === "ended") {
          loadAndEmitAudioSource(
            src,
            audioContext,
            analyser,
            sourceRef,
            onSourceEnded,
            onAudioStateChange,
            onSourceLoaded
          ).then(() => {
            /**
             * This may seem counterintuitive, but it's necessary when to restart the audio when the user wants
             * If the autostart is true, it handles that automatically in the pending state,
             * If not, we have to start the audio manually
             */
            if (!autoStart) {
              startAudioSource(sourceRef.current!, startAnimation);
              onSourceStarted?.();
              onAudioStateChange("playing");
            }
          });

          /**
           * If the previous state was paused, it means that
           * the user wants to resume the audio source,
           * so resume the source animation of the visualizer.
           */
        } else if (prevState.current === "paused") {
          startAnimation();
        }

        audioContext.resume();

        break;
      }

      /**
       * If the audio state is paused, stop the animation and suspend the audio context
       */
      case "paused": {
        stopAnimation();
        audioContext.suspend();
        break;
      }

      /**
       * If the audio state is ended, stop the animation.
       */
      case "ended": {
        stopAnimation();
        onSourceEnded?.();
        break;
      }
    }

    /**
     * Update the previous state
     */
    prevState.current = audioState;
  }, [audioState]);

  return <canvas {...props} ref={canvasRef} />;
};

export { AudioVisualizer };
