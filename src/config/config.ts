import { sync } from 'glob'
import { union } from 'lodash'
import { env } from 'process';

export default class Config {
  public static routes: string = './dist/routes/**/*.js'
  public static globFiles(location: string): string[] {
    return union([], sync(location))
  }
}
