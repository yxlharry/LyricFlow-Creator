import { AppSettings, LyricLine } from '../types';

interface RenderContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  image: HTMLImageElement | null;
  lyrics: LyricLine[];
  currentTime: number;
  smoothActiveIndex: number;
  absoluteTime: number; // Monotonic time for animations independent of audio
  isIntro: boolean; 
  settings: AppSettings;
}

// Helper to convert hex to RGB object
function hexToRgb(hex: string) {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, (m, r, g, b) => {
    return r + r + g + g + b + b;
  });

  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 255, g: 255, b: 255 };
}

// Linear interpolation
function lerp(start: number, end: number, t: number) {
  return start * (1 - t) + end * t;
}

// Color interpolation
function interpolateColor(color1: string, color2: string, factor: number) {
    const c1 = hexToRgb(color1);
    const c2 = hexToRgb(color2);
    const f = Math.max(0, Math.min(1, factor));
    const r = Math.round(c1.r + (c2.r - c1.r) * f);
    const g = Math.round(c1.g + (c2.g - c1.g) * f);
    const b = Math.round(c1.b + (c2.b - c1.b) * f);
    return `rgb(${r}, ${g}, ${b})`;
}

// Helper to wrap text into lines based on maxWidth
function getWrappedLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = ctx.measureText(currentLine + " " + word).width;
        if (width < maxWidth) {
            currentLine += " " + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);
    return lines;
}

/**
 * Draws a rounded rectangle image
 */
function drawRoundedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.closePath();
  ctx.clip();
  
  // Draw image covering the area
  const imgRatio = img.width / img.height;
  const areaRatio = width / height;
  
  let drawWidth, drawHeight, offsetX, offsetY;
  
  if (imgRatio > areaRatio) {
    drawHeight = height;
    drawWidth = height * imgRatio;
    offsetX = x - (drawWidth - width) / 2;
    offsetY = y;
  } else {
    drawWidth = width;
    drawHeight = width / imgRatio;
    offsetX = x;
    offsetY = y - (drawHeight - height) / 2;
  }

  ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
  ctx.restore();
  
  // Border
  ctx.save();
  ctx.beginPath();
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.roundRect(x, y, width, height, radius);
  ctx.stroke();
  ctx.restore();
}

/**
 * Procedurally draws floating bokeh spots
 */
function drawBokeh(ctx: CanvasRenderingContext2D, width: number, height: number, time: number, settings: AppSettings) {
    ctx.save();
    // Use 'screen' or 'lighter' for that dreamy light-addition effect
    ctx.globalCompositeOperation = 'screen';
    
    // Number of particles
    const particleCount = 15;
    
    for (let i = 0; i < particleCount; i++) {
        // Deterministic randomness based on index
        const randomBase = (i * 1337) % 1000; 
        
        // Speed variation
        const speed = 0.0002 + (randomBase % 100) * 0.00001;
        
        // Movement logic: Sine waves for smooth floating
        const t = time * speed + randomBase;
        
        // Position: Bias towards edges
        // We want particles mostly on left/right/bottom, avoiding center text area if possible
        const side = i % 2 === 0 ? -1 : 1; // Left or Right bias
        const xBase = width / 2 + (width / 2.5) * side; 
        const xOffset = Math.sin(t) * (width * 0.2);
        const x = xBase + xOffset;
        
        const yBase = height * (0.2 + ((randomBase % 10) / 10) * 0.8); // Spread vertically
        const yOffset = Math.cos(t * 1.3) * (height * 0.15);
        const y = yBase + yOffset;

        // Size
        let radius = 100;
        if (settings.bokehAutoSize) {
            // Oscillate size
            radius = 150 + Math.sin(t * 2) * 80 + (randomBase % 100);
        } else {
            // Fixed base size + slight oscillation
            const baseSize = 50 + (settings.bokehScale * 4); // Map 0-100 to 50-450
            radius = baseSize + Math.sin(t * 3) * 20;
        }

        // Color
        let r, g, b;
        if (settings.bokehAutoColor) {
            // Slowly cycle hues or pick from a palette based on time
            // Let's cycle harmoniously
            const hue = (t * 50 + randomBase) % 360;
            // Convert HSL to RGB roughly or just use string
            // But we need RGBA for gradient
            ctx.fillStyle = `hsla(${hue}, 70%, 60%, 0)`; // Placeholder
            // We'll use the gradient string directly
        } else {
            const rgb = hexToRgb(settings.bokehColor);
            r = rgb.r; g = rgb.g; b = rgb.b;
        }

        // Create Gradient for soft spot
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        
        // Alpha calculation: Pulse in and out
        const alphaBase = 0.15;
        const alpha = alphaBase + Math.sin(t * 1.7) * 0.05;

        if (settings.bokehAutoColor) {
            const hue = (t * 50 + randomBase) % 360;
            gradient.addColorStop(0, `hsla(${hue}, 80%, 60%, ${alpha})`);
            gradient.addColorStop(1, `hsla(${hue}, 80%, 60%, 0)`);
        } else {
            const { r, g, b } = hexToRgb(settings.bokehColor);
            gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
            gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        }

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }
    
    ctx.restore();
}

export const renderFrame = ({
  ctx,
  width,
  height,
  image,
  lyrics,
  currentTime,
  smoothActiveIndex,
  absoluteTime,
  isIntro,
  settings,
}: RenderContext) => {
  // 1. Clear Screen
  ctx.clearRect(0, 0, width, height);

  // 2. Draw Background
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, settings.backgroundColor);
  gradient.addColorStop(1, '#020617');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // 3. Draw blurred background image layer
  if (image) {
      ctx.save();
      ctx.globalAlpha = 0.15;
      ctx.filter = 'blur(60px) saturate(150%)';
      ctx.drawImage(image, -width * 0.2, -height * 0.2, width * 1.4, height * 1.4);
      ctx.restore();
  }

  // 4. Draw Bokeh Overlay (Behind content, over background)
  if (settings.bokehEnabled) {
      drawBokeh(ctx, width, height, absoluteTime, settings);
  }

  // Layout Constants
  const leftPanelWidth = width * 0.4;
  const rightPanelStart = width * (settings.lyricsXOffset / 100); // Adjustable X
  const rightPanelWidth = width - rightPanelStart - 50; // Remaining width minus padding
  const verticalCenter = height / 2;

  // 5. Draw Album Art (Left Side)
  if (image) {
    const imgSize = Math.min(leftPanelWidth * 0.75, height * 0.55);
    const imgX = (leftPanelWidth - imgSize) / 2 + 60;
    const imgY = (height - imgSize) / 2;
    
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 20;
    
    drawRoundedImage(ctx, image, imgX, imgY, imgSize, imgSize, 24);
    ctx.restore();
  } else {
    // Placeholder
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    const imgSize = Math.min(leftPanelWidth * 0.75, height * 0.55);
    const imgX = (leftPanelWidth - imgSize) / 2 + 60;
    const imgY = (height - imgSize) / 2;
    
    ctx.beginPath();
    ctx.roundRect(imgX, imgY, imgSize, imgSize, 24);
    ctx.fill();
    
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '500 32px Inter';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No Cover Art', imgX + imgSize/2, imgY + imgSize/2);
  }

  // 6. INTRO MODE: Show Title
  if (isIntro) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      
      const titleX = rightPanelStart;
      const titleY = verticalCenter;
      
      ctx.save();
      ctx.font = `bold ${settings.fontSize * 1.5}px Inter, sans-serif`;
      ctx.fillStyle = settings.primaryColor;
      ctx.shadowColor = settings.primaryColor;
      ctx.shadowBlur = settings.glowIntensity * 1.5;
      
      // Wrap title if needed
      const titleLines = getWrappedLines(ctx, settings.songTitle || "Unknown Track", rightPanelWidth);
      
      titleLines.forEach((line, idx) => {
          const yOff = (idx - (titleLines.length - 1) / 2) * (settings.fontSize * 1.8);
          ctx.fillText(line, titleX, titleY + yOff);
      });
      
      ctx.restore();
      return;
  }

  // 7. LYRICS MODE
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  
  const baseFontSize = settings.fontSize;
  const lineHeight = baseFontSize * 2.2;
  const maxVisibleDist = 5;

  const startIndex = Math.max(0, Math.floor(smoothActiveIndex - maxVisibleDist));
  const endIndex = Math.min(lyrics.length - 1, Math.ceil(smoothActiveIndex + maxVisibleDist));

  for (let i = startIndex; i <= endIndex; i++) {
    const line = lyrics[i];
    const distance = i - smoothActiveIndex; 
    const yPos = verticalCenter + (distance * lineHeight);
    const absDist = Math.abs(distance);
    
    // Scale Logic - Cosine easing for smoother center transition
    let scale = 1.0;
    if (absDist < 1.0) {
        // Cosine-based ease (smooth bell curve shape) to avoid sharp "point" at 0
        const ease = (1 + Math.cos(Math.PI * absDist)) / 2; // Goes from 1.0 (at 0) to 0.0 (at 1)
        scale = 1.0 + 0.15 * ease;
    }

    // Color & Alpha Logic
    let color = settings.secondaryColor;
    let alpha = 1.0;
    let blur = 0;

    if (absDist < 0.6) {
        const factor = absDist * 1.66; // Normalize 0.6 to 1.0
        color = interpolateColor(settings.primaryColor, settings.secondaryColor, factor);
    }
    
    if (absDist > 2) {
        alpha = Math.max(0, 1 - (absDist - 2) * 0.4);
    }
    
    if (absDist > 1.2) {
        blur = (absDist - 1.2) * 2;
    }

    if (alpha <= 0.01) continue;

    ctx.save();
    ctx.translate(rightPanelStart, yPos);
    ctx.scale(scale, scale);
    
    if (blur > 0) ctx.filter = `blur(${blur}px)`;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    
    const fontWeight = absDist < 0.4 ? '700' : '600';
    ctx.font = `${fontWeight} ${baseFontSize}px Inter, sans-serif`;

    // Glow
    if (absDist < 0.4) {
        ctx.shadowColor = settings.primaryColor;
        ctx.shadowBlur = settings.glowIntensity * (1 - absDist/0.4);
    }

    // Wrapping Logic
    const wrappedLines = getWrappedLines(ctx, line.text, rightPanelWidth / scale);
    
    // Draw lines centered vertically around the logical Y line position
    const totalHeight = (wrappedLines.length - 1) * (baseFontSize * 1.1);
    const startY = -totalHeight / 2;

    wrappedLines.forEach((txt, lineIdx) => {
        const lineY = startY + (lineIdx * (baseFontSize * 1.1));
        ctx.fillText(txt, 0, lineY);
    });

    ctx.restore();
  }
};