/**
 * Advanced Arabic Text Reshaper & Bidirectional Engine for Web Terminals
 * Solves:
 * 1. Letter disconnection (Contextual Shaping -> Presentation Forms-B)
 * 2. Visual BiDi reordering for LTR Monospace Terminal Grids
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ArabicReshaper = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // Letter shapes mapping: [Isolated, Initial, Medial, Final]
  const CHAR_MAP = {
    0x0621: [0xFE80, null, null, null], // Hamza
    0x0622: [0xFE81, null, null, 0xFE82], // Alef with Madda
    0x0623: [0xFE83, null, null, 0xFE84], // Alef with Hamza Above
    0x0624: [0xFE85, null, null, 0xFE86], // Waw with Hamza Above
    0x0625: [0xFE87, null, null, 0xFE88], // Alef with Hamza Below
    0x0626: [0xFE89, 0xFE8B, 0xFE8C, 0xFE8A], // Yeh with Hamza Above
    0x0627: [0xFE8D, null, null, 0xFE8E], // Alef
    0x0628: [0xFE8F, 0xFE91, 0xFE92, 0xFE90], // Beh
    0x0629: [0xFE93, null, null, 0xFE94], // Teh Marbuta
    0x062A: [0xFE95, 0xFE97, 0xFE98, 0xFE96], // Teh
    0x062B: [0xFE99, 0xFE9B, 0xFE9C, 0xFE9A], // Theh
    0x062C: [0xFE9D, 0xFE9F, 0xFEA0, 0xFE9E], // Jeem
    0x062D: [0xFEA1, 0xFEA3, 0xFEA4, 0xFEA2], // Hah
    0x062E: [0xFEA5, 0xFEA7, 0xFEA8, 0xFEA6], // Khah
    0x062F: [0xFEA9, null, null, 0xFEAA], // Dal
    0x0630: [0xFEAB, null, null, 0xFEAC], // Thal
    0x0631: [0xFEAD, null, null, 0xFEAE], // Reh
    0x0632: [0xFEAF, null, null, 0xFEB0], // Zain
    0x0633: [0xFEB1, 0xFEB3, 0xFEB4, 0xFEB2], // Seen
    0x0634: [0xFEB5, 0xFEB7, 0xFEB8, 0xFEB6], // Sheen
    0x0635: [0xFEB9, 0xFEBB, 0xFEBC, 0xFEBA], // Sad
    0x0636: [0xFEBD, 0xFEBF, 0xFEC0, 0xFEBE], // Dad
    0x0637: [0xFEC1, 0xFEC3, 0xFEC4, 0xFEC2], // Tah
    0x0638: [0xFEC5, 0xFEC7, 0xFEC8, 0xFEC6], // Zah
    0x0639: [0xFEC9, 0xFECB, 0xFECC, 0xFECA], // Ain
    0x063A: [0xFECD, 0xFECF, 0xFED0, 0xFECE], // Ghain
    0x0641: [0xFED1, 0xFED3, 0xFED4, 0xFED2], // Feh
    0x0642: [0xFED5, 0xFED7, 0xFED8, 0xFED6], // Qaf
    0x0643: [0xFED9, 0xFEDB, 0xFEDC, 0xFEDA], // Kaf
    0x0644: [0xFEDD, 0xFEDF, 0xFEE0, 0xFEDE], // Lam
    0x0645: [0xFEE1, 0xFEE3, 0xFEE4, 0xFEE2], // Meem
    0x0646: [0xFEE5, 0xFEE7, 0xFEE8, 0xFEE6], // Noon
    0x0647: [0xFEE9, 0xFEEB, 0xFEEC, 0xFEEA], // Heh
    0x0648: [0xFEED, null, null, 0xFEEE], // Waw
    0x0649: [0xFEEF, 0xFBE8, 0xFBE9, 0xFEF0], // Alef Maksura
    0x064A: [0xFEF1, 0xFEF3, 0xFEF4, 0xFEF2], // Yeh
    0x067E: [0xFB56, 0xFB58, 0xFB59, 0xFB57], // Peh
    0x0686: [0xFB7A, 0xFB7C, 0xFB7D, 0xFB7B], // Tcheh
    0x0698: [0xFB8A, null, null, 0xFB8B], // Jeh
    0x06AF: [0xFB92, 0xFB94, 0xFB95, 0xFB93]  // Gaf
  };

  // Lam-Alef Ligatures mapping: [Isolated, Final]
  const LAM_ALEF = {
    0x0622: [0xFEF5, 0xFEF6], // Lam + Alef with Madda
    0x0623: [0xFEF7, 0xFEF8], // Lam + Alef with Hamza Above
    0x0625: [0xFEF9, 0xFEFA], // Lam + Alef with Hamza Below
    0x0627: [0xFEFB, 0xFEFC]  // Lam + Plain Alef
  };

  const TASHKEEL = [
    0x064B, 0x064C, 0x064D, 0x064E, 0x064F, 0x0650, 0x0651, 0x0652, 0x0670
  ];

  function isArabic(code) {
    return CHAR_MAP.hasOwnProperty(code);
  }

  function isTashkeel(code) {
    return TASHKEEL.includes(code);
  }

  function connectsToNext(code) {
    const entry = CHAR_MAP[code];
    return entry && (entry[1] !== null || entry[2] !== null);
  }

  function connectsToPrev(code) {
    const entry = CHAR_MAP[code];
    return entry && (entry[2] !== null || entry[3] !== null);
  }

  // Reshape a single Arabic string (connects isolated letters into contextual forms)
  function reshapeString(text) {
    if (!text || typeof text !== 'string') return text;

    let chars = [];
    for (let i = 0; i < text.length; i++) {
      chars.push(text.charCodeAt(i));
    }

    let output = [];
    const len = chars.length;

    for (let i = 0; i < len; i++) {
      const code = chars[i];

      if (isTashkeel(code)) {
        output.push(String.fromCharCode(code));
        continue;
      }

      if (!isArabic(code)) {
        output.push(String.fromCharCode(code));
        continue;
      }

      // Check Lam-Alef ligature
      if (code === 0x0644 && i + 1 < len) {
        let nextIdx = i + 1;
        while (nextIdx < len && isTashkeel(chars[nextIdx])) nextIdx++;
        if (nextIdx < len && LAM_ALEF.hasOwnProperty(chars[nextIdx])) {
          const alefCode = chars[nextIdx];
          let prevIdx = i - 1;
          while (prevIdx >= 0 && isTashkeel(chars[prevIdx])) prevIdx--;
          const prevCode = prevIdx >= 0 ? chars[prevIdx] : null;
          const connectsPrev = prevCode && isArabic(prevCode) && connectsToNext(prevCode);

          const lig = LAM_ALEF[alefCode];
          output.push(String.fromCharCode(connectsPrev ? lig[1] : lig[0]));
          i = nextIdx;
          continue;
        }
      }

      let prevIdx = i - 1;
      while (prevIdx >= 0 && isTashkeel(chars[prevIdx])) prevIdx--;
      const prevCode = prevIdx >= 0 ? chars[prevIdx] : null;

      let nextIdx = i + 1;
      while (nextIdx < len && isTashkeel(chars[nextIdx])) nextIdx++;
      const nextCode = nextIdx < len ? chars[nextIdx] : null;

      const connectsPrev = prevCode && isArabic(prevCode) && connectsToNext(prevCode);
      const connectsNext = nextCode && isArabic(nextCode) && connectsToPrev(nextCode);

      const entry = CHAR_MAP[code];
      let shapedCode = code;

      if (connectsPrev && connectsNext && entry[2] !== null) {
        shapedCode = entry[2]; // Medial
      } else if (connectsPrev && entry[3] !== null) {
        shapedCode = entry[3]; // Final
      } else if (connectsNext && entry[1] !== null) {
        shapedCode = entry[1]; // Initial
      } else if (entry[0] !== null) {
        shapedCode = entry[0]; // Isolated
      }

      output.push(String.fromCharCode(shapedCode));
    }

    return output.join('');
  }

  // Reverse Arabic segment for LTR visual terminal display
  function reverseArabicSegment(str) {
    return Array.from(str).reverse().join('');
  }

  // Process a line of text: shapes Arabic words and adjusts visual BiDi order
  function processBidi(line, reorderBidi = false) {
    if (!line || typeof line !== 'string') return line;
    if (!hasArabic(line)) return line;

    // Reshape all Arabic words
    const reshaped = reshapeString(line);

    if (!reorderBidi) {
      return reshaped;
    }

    // BiDi visual reordering: reverse Arabic chunks so they read correctly in LTR terminal
    return reshaped.replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+/g, (match) => {
      return reverseArabicSegment(match);
    });
  }

  function hasArabic(text) {
    return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
  }

  return {
    reshape: reshapeString,
    processBidi: processBidi,
    hasArabic: hasArabic
  };
}));
