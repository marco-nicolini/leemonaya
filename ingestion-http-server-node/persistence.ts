import { StationReadingsMsg, StationFeed } from "./messages";
import BetterSqlite3 from 'better-sqlite3';
import Database from 'better-sqlite3';
import { groupBy, nearestTick } from "./util";

export interface PersistenceService {
    store(payload: StationReadingsMsg): StationFeed;
    load(from: number, to: number): StationFeed[];
    loadLatest(from: number): StationFeed[];
}

/**
 * keys must match db table
 */
interface Row {
    rowid: any;
    station_id: string,
    tstamp: number,
    payload: string
}

function toStationFeed(row: Row): StationFeed {
    const readings = JSON.parse(row.payload) as StationReadingsMsg;
    return {
        id: row.rowid.toString(),
        stationId: row.station_id,
        tstamp: row.tstamp,
        humidity: readings.humidity,
        temperature: readings.temperature
    }
}

class Sqlite3PersistenceService implements PersistenceService {

    private readonly db: BetterSqlite3.Database;
    
    constructor(fileName: string) {
        this.db = new Database(fileName);
        const stmt = this.db.prepare(`
            CREATE TABLE IF NOT EXISTS station_readings
                (station_id TEXT,
                tstamp INTEGER,
                payload TEXT)
        `);
        stmt.run();
    }

    store(msg: StationReadingsMsg): StationFeed {
        const statement = this.db.prepare(`
            INSERT INTO station_readings (station_id, tstamp, payload) VALUES (?, ?, ?)
        `)
        const tstamp = new Date().getTime();
        const result = statement.run(msg.stationId, tstamp, JSON.stringify(msg));
        return {
            id: result.lastInsertRowid.toString(),
            stationId: msg.stationId,
            humidity: msg.humidity,
            temperature: msg.temperature,
            tstamp: tstamp
        }
    }

    load(from: number, to: number): StationFeed[] {
        const statement = this.db.prepare(`SELECT rowid, * FROM station_readings WHERE tstamp > ? AND tstamp < ? ORDER BY rowid ASC`)
        return (statement.all(from, to) as Row[])
            //.map(identityLogger)
            .map(toStationFeed);
    }

    loadLatest(from: number): StationFeed[] {
        const statement = this.db.prepare(`SELECT rowid, * FROM station_readings WHERE tstamp > ? ORDER BY rowid ASC`)
        return (statement.all(from) as Row[])
            // .map(identityLogger)
            .map(toStationFeed);
    }
}


/**
 * Decimates the StationFeed array by grouping and averaging on timestamp buckets.
 * @param feeds assumed ordered by timestamp.
 * @param millisWindowSize 
 */
export function decimate(feeds: StationFeed[], millisWindowSize: number): StationFeed[] {
    let sameIdAndSameRoundedTstamp: (feed: StationFeed) => any = feed => ({
        tstamp: nearestTick(feed.tstamp, millisWindowSize),
        stationId: feed.stationId
    });

    return groupBy(feeds, sameIdAndSameRoundedTstamp)
        .filter(group => group.length > 0)
        .map(feeds => {
                const avg = feeds.reduce((acc, feed) => ({
                        tstamp: nearestTick(acc.tstamp, millisWindowSize),
                        id: acc.id,
                        stationId: acc.stationId,
                        humidity: (acc.humidity + feed.humidity),
                        temperature: (acc.temperature + feed.temperature),
                    }))
                avg.humidity = avg.humidity / feeds.length
                avg.temperature = avg.temperature / feeds.length
                return avg;
            }
        );
}

function identityLogger<T>(t: T): T {
    console.log(`--> [${JSON.stringify(t)}]`)
    return t;
}

export class PersistenceServiceFactory {
    public static get(): PersistenceService {
        return new Sqlite3PersistenceService('leemonaya.sqlite3'); // TODO make configurable
    }
}