const puppeteer = require('puppeteer');
const path = require('path');

const docs = [
  {
    html: 'BBPS-Credit-Card-Bill-Payment-API-Documentation.html',
    pdf: 'SameDaySolution-BBPS-Credit-Card-Bill-Payment-API-Documentation.pdf',
    footer: 'Same Day Solution Pvt. Ltd. — BBPS-2 Credit Card Bill Payment API'
  },
  {
    html: 'Settlement-API-Documentation.html',
    pdf: 'SameDaySolution-Settlement-API-Documentation.pdf',
    footer: 'Same Day Solution Pvt. Ltd. — Settlement API'
  }
];

(async () => {
  const browser = await puppeteer.launch();

  for (const doc of docs) {
    const page = await browser.newPage();
    const htmlPath = path.resolve(__dirname, doc.html);
    await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });

    const pdfPath = path.resolve(__dirname, doc.pdf);
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="font-size:9px;color:#999;width:100%;text-align:center;padding:0 40px;">${doc.footer} | Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
    });

    console.log('Generated:', doc.pdf);
    await page.close();
  }

  await browser.close();
  console.log('All PDFs generated successfully.');
})();
