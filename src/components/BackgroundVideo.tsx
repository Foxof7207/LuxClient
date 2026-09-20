import React, { useEffect, useRef, useState } from 'react';

const MAX_RETRIES = 5;

interface BackgroundVideoProps {
    src: string;
    className?: string;
    style?: React.CSSProperties;
}

function BackgroundVideo({ src, className, style }: BackgroundVideoProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const failures = useRef(0);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        failures.current = 0;
    }, [src]);

    useEffect(() => () => {
        if (retryTimer.current) clearTimeout(retryTimer.current);
    }, []);

    const scheduleRetry = () => {
        if (retryTimer.current || failures.current >= MAX_RETRIES) return;
        failures.current += 1;
        retryTimer.current = setTimeout(() => {
            retryTimer.current = null;
            setReloadKey((value) => value + 1);
        }, 1000 * failures.current);
    };

    const resumeIfPaused = () => {
        const video = videoRef.current;
        if (video && video.paused && !document.hidden) {
            video.play().catch(() => { });
        }
    };

    useEffect(() => {
        const onVisible = () => resumeIfPaused();
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, []);

    return (
        <video
            key={`${src}#${reloadKey}`}
            ref={videoRef}
            src={src}
            autoPlay muted loop playsInline
            preload="auto"
            className={className}
            style={style}
            onCanPlay={resumeIfPaused}
            onPlaying={() => {
                failures.current = 0;
            }}
            onError={(e) => {
                console.error('Background video error:', (e.currentTarget as HTMLVideoElement).error);
                scheduleRetry();
            }}
        />
    );
}

export default BackgroundVideo;
