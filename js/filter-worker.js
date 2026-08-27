self.onmessage = function(e) {
  const { data, width, height, amount } = e.data;
  const factor = amount / 50;
  const kernel = [0, -factor, 0, -factor, 1 + 4 * factor, -factor, 0, -factor, 0];
  const output = new Uint8ClampedArray(data);
  const totalPixels = height - 2;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let ki = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const pidx = ((y + ky) * width + (x + kx)) * 4 + c;
            sum += data[pidx] * kernel[ki++];
          }
        }
        output[idx + c] = Math.min(255, Math.max(0, sum));
      }
    }
    // Progress reporting
    if (y % 20 === 0) {
      self.postMessage({ progress: (y / totalPixels) * 100 });
    }
  }
  self.postMessage({ output, progress: 100 }, [output.buffer]);
};
