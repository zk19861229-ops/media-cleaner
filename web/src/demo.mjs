/** Synthetic pictures generated locally. No bundled stock photos or external requests. */
export async function demoFiles() {
  async function picture(name, scene, shift = 0) {
    const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 640;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = scene === 'coast' ? '#efb3a2' : scene === 'city' ? '#b8cfdb' : '#c4d7c1';
    ctx.fillRect(0, 0, 960, 640);
    ctx.fillStyle = '#fff0c1'; ctx.beginPath(); ctx.arc(700 + shift, 150, 66, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = scene === 'coast' ? '#688b9b' : '#557968';
    ctx.beginPath(); ctx.moveTo(0, 460); ctx.lineTo(270 + shift, 180); ctx.lineTo(650, 530); ctx.lineTo(960, 350); ctx.lineTo(960, 640); ctx.lineTo(0, 640); ctx.fill();
    ctx.fillStyle = scene === 'coast' ? '#c9dac9' : '#799a79';
    ctx.beginPath(); ctx.moveTo(0, 550); ctx.lineTo(570, 270); ctx.lineTo(960, 560); ctx.lineTo(960, 640); ctx.lineTo(0, 640); ctx.fill();
    if (scene === 'city') { ctx.fillStyle = '#f0e8d2'; for (let x = 100; x < 800; x += 110) ctx.fillRect(x, 330 - (x % 3) * 40, 70, 230); }
    ctx.fillStyle = '#fff'; ctx.font = '24px sans-serif'; ctx.fillText('SPACE KEEPER · GENERATED DEMO', 40, 600);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
    return new File([blob], name, { type: 'image/jpeg', lastModified: 1750000000000 });
  }
  const coast = await picture('海边的傍晚.jpg', 'coast');
  const city = await picture('城市散步.jpg', 'city');
  return [coast, new File([coast], '海边的傍晚_副本.jpg', { type: coast.type, lastModified: coast.lastModified }),
    await picture('山间漫步_01.jpg', 'mountain', 5), await picture('山间漫步_02.jpg', 'mountain', 12),
    city, new File([city], 'Screenshot_留存.jpg', { type: city.type, lastModified: city.lastModified })];
}
