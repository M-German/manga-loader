import { existsSync, createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import { resolve as _resolve } from "path";
import { launch } from 'puppeteer';
import logUpdate from 'log-update'; 

const downloadFile = async (url, downloadPath=['downloads'], fileName) => {
    let path = downloadPath.join('/');
    if (!existsSync(path)) {
        let partialPath = ""
        for(let i=0; i < downloadPath.length; i++) {
            partialPath = _resolve(partialPath, downloadPath[i]);
            if (!existsSync(partialPath)) await mkdir(partialPath);
        }
    }

    const res = await fetch(url);
    const destination = _resolve(path, fileName);
    const fileStream = createWriteStream(destination, { flags: 'wx' });
    await finished(Readable.fromWeb(res.body).pipe(fileStream));
};

const scrollToItem = (elementHandle) => {
    return new Promise((resolve, reject) => {
        elementHandle.scrollIntoView();
        setTimeout(() => resolve(), 200);
    })
}

const downloadMangaPages = async (url="") => {
    if(!url) return;

    try {
        let imgUrls = [];
        let seriesName = url.match(/(?<=(series\/)).+(?=\/(epi))/)[0];
        let episodeName = url.match(/(?<=(episodes\/))[^\?]+/)[0];
        
        const browser = await launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(
            url, { waitUntil: 'networkidle2' }
        );

        // Прокрутка для изначальной прогрузки изображений
        await page.evaluate(() => document.scrollingElement.scrollBy(0, 1000));

        // Все контейнеры под изображения
        const imgContainers = await page.$$('._91qwou3');
        const itemsTotal = imgContainers.length;

        // Количество контейнеров, содержащих в данный момент внутри себя тег img
        const itemsOnPage = (await page.$$('._91qwou3 > img')).length;
        
        let count = 0;
        
        for(let index = 0; index < itemsTotal; index++) {
            let url = await imgContainers[index].$eval('img', el => el.src);
            downloadFile(url, ['downloads', seriesName, episodeName], `${index}.jpg`);
            imgUrls.push(url);
            logUpdate(`Загрузка (${index+1}/${itemsTotal})`)

            count++;
            if(count >= itemsOnPage) {
                count = 0;
                let nextContainerIndex = -1;
                if(index+2 < imgContainers.length) nextContainerIndex = index+2;
                else if(index+1 < imgContainers.length) nextContainerIndex = index+1;

                if(nextContainerIndex > -1) {
                    await scrollToItem(imgContainers[nextContainerIndex]);
                }
            }
            
        }
        browser.close();
        console.log("Готово");
        // console.log(imgUrls);
    }
    catch {
        console.error("Ошибка при парсинге");
    }
}

const args = process.argv.slice(2);
const url = args[0];

if(!!url) {
    downloadMangaPages(url);
}
else {
    console.error('no url');
}

