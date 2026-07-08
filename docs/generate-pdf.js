const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  const htmlPath = path.resolve(__dirname, 'POS-Transaction-API-Documentation.html');
  await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });

  const pdfPath = path.resolve(__dirname, 'SameDaySolution-POS-Transaction-API-Documentation.pdf');
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="font-size:9px;color:#999;width:100%;text-align:center;padding:0 40px;">Same Day Solution Pvt. Ltd. — POS Transaction API &nbsp;|&nbsp; Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
  });

  console.log('PDF generated:', pdfPath);
  await browser.close();
})();
