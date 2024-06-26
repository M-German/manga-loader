import { existsSync, createWriteStream } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import { resolve as _resolve } from "path";
import { launch } from 'puppeteer';
import logUpdate from 'log-update'; 
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';


const downloadFile = async (url, path='downloads', fileName) => {
    let downloadPath = path.split('/');
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
    return finished(Readable.fromWeb(res.body).pipe(fileStream));
};

const scrollToItem = (elementHandle) => {
    return new Promise((resolve, reject) => {
        elementHandle.scrollIntoView();
        setTimeout(() => resolve(), 200);
    })
}

const downloadMangaPages = async (page, seriesName, episodeName) => {
    let imgUrls = [];
    try {
        let downloadPath = `downloads/${seriesName}/${episodeName}`;

        if (existsSync(downloadPath)) {
            throw `Папка '${downloadPath}' уже существует`;
        }

        // Прокрутка для изначальной прогрузки изображений
        await page.evaluate(() => document.scrollingElement.scrollBy(0, 1000));

        // Все контейнеры под изображения
        const imgContainers = await page.$$('._91qwou3');
        const itemsTotal = imgContainers.length;

        // Количество контейнеров, содержащих в данный момент внутри себя тег img
        const itemsOnPage = (await page.$$('._91qwou3 > img')).length;
        
        let count = 0;
        let downloads = [];
        for(let index = 0; index < itemsTotal; index++) {
            let url = await imgContainers[index].$eval('img', el => el.src);
            downloads.push(
                downloadFile(url, downloadPath, `${index}.jpg`)
            );
            imgUrls.push(url);
            logUpdate(`Загрузка (${index+1}/${itemsTotal})`);

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

        await Promise.allSettled(downloads);

        return { urls: imgUrls };
    }
    catch(err) {
        throw { urls: imgUrls, error: err };
    }
}

const loadData = () => {
    return new Promise(async (resolve, reject) => {
        const DATA_FILE_PATH = './data.json'
        try {
            if (existsSync(DATA_FILE_PATH)) {
                let dataString = await readFile(DATA_FILE_PATH);
                if(dataString) resolve(JSON.parse(dataString));
            }
            resolve({});
        }
        catch { resolve({}); }
    });
}

const saveData = (data) => {
    const dataJson = JSON.stringify(data, null, 2);
    return writeFile('./data.json', dataJson);
}

const pageContainsText = async (page, text) => {
    let bodyText = await page.evaluate(() => document.body.textContent);
    return bodyText?.includes(text);
}

(async () => {
    console.log('Запуск браузера...');
    const browser = await launch({ headless: true });
    try {
        const args = process.argv.slice(2);
        const url = args[0];
        if(!url) throw "No url";

        const page = await browser.newPage();
        await page.setViewport({width: 1080, height: 1024});
        await page.goto(url, { waitUntil: 'networkidle2' });

        let seriesName = url.match(/(?<=(series\/)).+(?=\/(epi))/)[0];
        let episodeName = url.match(/(?<=(episodes\/))[^\?]+/)[0];

        console.log('Загрузка данных...');
        const data = await loadData();
        const needLogin = await pageContainsText(page, 'Sign in');
        
        if(needLogin) {
            let cookies = Array.isArray(data.cookies) ? data.cookies : [];

            if(cookies.findIndex(c => c.name === 'token') === -1)  {
                const rl = readline.createInterface({ input, output });
                let token;

                do {
                    token = await rl.question('\nДля доступа к главе требуется аутентификация, введите токен:\n');
                    rl.close();
                } while(!token);
                
                cookies = [...cookies, {
                    url: "https://manta.net/",
                    name: 'token',
                    domain: 'manta.net',
                    value: token,
                    expires: Date.now() + 24*60*60*1000,
                    httpOnly: true,
                    path: '/',        
                }];

                await saveData({ ...data, cookies });
            }
            
            // Куки
            await page.setCookie(...cookies);

            // Нелепый костыль для обхода аутентификации
            await page.reload({ waitUntil: 'networkidle2' });

            // Клик по кнопке подтверждения триала
            let trialButton = await page.$('._1qwazup7._1qwazup5 > ._1qwazup8');
            if(trialButton) {
                await trialButton.click();
                await page.waitForNetworkIdle({ idleTime: 500, concurrency: 2 });
            }
            else {
                let isSubscribeClause = pageContainsText(page, 'Subscribe now');
                if(isSubscribeClause) {
                    await page.reload({ waitUntil: 'networkidle2' });
                }
                else {
                    throw "Кнопка триала не найдена, увы. Попробуйте удалить data.json и ввести новый токен."
                }
            }
            
        }

        await downloadMangaPages(page, seriesName, episodeName);
        browser.close();
        console.log("Готово!");
    }
    catch(err) {
        console.error("Что-то пошло не так");
        browser.close();
        if(err?.error) {
            console.error(err.error);
            if(err.urls?.length) console.log("URLs:\n", err.urls);
        }
        else console.error(err);
    }
    
})();
