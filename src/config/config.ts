import { sync } from 'glob'
import { union } from 'lodash'

export default class Config {
  public static routes: string = './dist/routes/**/*.js'
  public static globFiles(location: string): string[] {
    return union([], sync(location))
  }
}
